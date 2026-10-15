import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer as createHttpServer } from "node:http";
import { createGatewayServer } from "../src/server.js";
import { GatewayStore } from "../src/store.js";
import { signWebhook, verifyWebhookSignature } from "../src/security.js";
import sandboxProvider from "../src/providers/sandbox.js";

const apiKey = "test-api-key-".padEnd(64, "a");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function createConfig(overrides = {}) {
  return {
    nodeEnv: "test",
    apiKey,
    providerName: "sandbox",
    webhookSecret: "test-webhook-secret-".padEnd(64, "b"),
    webhookUrl: "",
    publicOrigin: "http://127.0.0.1",
    maxAmount: 10_000_000,
    defaultExpirySeconds: 900,
    ...overrides,
  };
}

test("sandbox order lifecycle and API access", async (t) => {
  const store = new GatewayStore(":memory:");
  const config = createConfig();
  const server = createGatewayServer({ config, store, provider: sandboxProvider, logger: { error() {} } });
  const origin = await listen(server);
  config.publicOrigin = origin;
  t.after(async () => {
    await close(server);
    store.close();
  });

  const health = await fetch(`${origin}/api/v1/health`).then((response) => response.json());
  assert.equal(health.ok, true);
  assert.equal(health.provider, "sandbox");

  const unauthorized = await fetch(`${origin}/api/v1/dashboard`);
  assert.equal(unauthorized.status, 401);

  const create = (reference, amount) => fetch(`${origin}/api/v1/payments`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ merchant_reference: reference, amount, description: "Order test" }),
  });

  const createdResponse = await create("ORD-TEST-001", 50_000);
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.data.status, "pending");
  assert.equal(created.data.amount, 50_000);
  assert.equal(new URL(created.data.checkout_url).origin, origin);

  const repeatedResponse = await create("ORD-TEST-001", 50_000);
  assert.equal(repeatedResponse.status, 200);
  const repeated = await repeatedResponse.json();
  assert.equal(repeated.data.id, created.data.id);
  assert.equal(repeated.data.idempotent, true);

  const conflict = await create("ORD-TEST-001", 75_000);
  assert.equal(conflict.status, 409);

  const invalidAmount = await create("ORD-TEST-002", 0);
  assert.equal(invalidAmount.status, 400);
  const invalidLimit = await fetch(`${origin}/api/v1/payments?limit=not-a-number`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  assert.equal(invalidLimit.status, 400);

  const publicPayment = await fetch(`${origin}/api/public/payments/${created.data.id}`).then((response) => response.json());
  assert.equal(publicPayment.data.status, "pending");
  assert.equal("apiKey" in publicPayment.data, false);

  const settledResponse = await fetch(`${origin}/api/sandbox/payments/${created.data.id}/settle`, { method: "POST" });
  assert.equal(settledResponse.status, 200);
  assert.equal((await settledResponse.json()).data.status, "paid");

  const repeatSettlement = await fetch(`${origin}/api/sandbox/payments/${created.data.id}/settle`, { method: "POST" }).then((response) => response.json());
  assert.equal(repeatSettlement.changed, false);

  const dashboard = await fetch(`${origin}/api/v1/dashboard`, { headers: { authorization: `Bearer ${apiKey}` } }).then((response) => response.json());
  assert.equal(dashboard.data.stats.total, 1);
  assert.equal(dashboard.data.stats.paid, 1);
  assert.equal(dashboard.data.stats.paid_amount, 50_000);

  const cancelPaid = await fetch(`${origin}/api/v1/payments/${created.data.id}/cancel`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
  });
  assert.equal(cancelPaid.status, 409);

  const noQueryKey = await fetch(`${origin}/api/v1/dashboard?api_key=${apiKey}`);
  assert.equal(noQueryKey.status, 401);
});

test("custom provider webhook verifies signature and transitions one order", async (t) => {
  const store = new GatewayStore(":memory:");
  const secret = "provider-signing-secret-".padEnd(64, "c");
  const provider = {
    name: "acme",
    async createPayment(payment) {
      return { reference: `acme-${payment.id}`, checkoutUrl: "https://checkout.example.test/order" };
    },
    async normalizeWebhook({ rawBody, headers }) {
      const timestamp = headers["x-provider-timestamp"];
      const signature = headers["x-provider-signature"];
      if (!verifyWebhookSignature(secret, timestamp, rawBody, signature)) throw new Error("Invalid signature");
      return JSON.parse(rawBody);
    },
  };
  const config = createConfig({ providerName: "acme", providerWebhookSecret: secret });
  const server = createGatewayServer({ config, store, provider, logger: { error() {} } });
  const origin = await listen(server);
  config.publicOrigin = origin;
  t.after(async () => {
    await close(server);
    store.close();
  });

  const createdResponse = await fetch(`${origin}/api/v1/payments`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ merchant_reference: "ACME-001", amount: 12_000 }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();

  const body = JSON.stringify({ reference: created.data.provider_reference, status: "settlement" });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signWebhook(secret, timestamp, body);
  const invalidWebhook = await fetch(`${origin}/api/v1/providers/acme/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-provider-timestamp": timestamp, "x-provider-signature": "0".repeat(64) },
    body,
  });
  assert.equal(invalidWebhook.status, 401);

  const webhook = await fetch(`${origin}/api/v1/providers/acme/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-provider-timestamp": timestamp, "x-provider-signature": signature },
    body,
  });
  assert.equal(webhook.status, 200);
  const response = await webhook.json();
  assert.equal(response.data.status, "paid");
  assert.equal(response.changed, true);

  const duplicate = await fetch(`${origin}/api/v1/providers/acme/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-provider-timestamp": timestamp, "x-provider-signature": signature },
    body,
  }).then((item) => item.json());
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.data.status, "paid");
});

test("webhook signatures are time-bound and body-bound", () => {
  const secret = "a-secure-test-secret-that-is-long-enough-to-be-used";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ event: "payment.paid" });
  const signature = signWebhook(secret, timestamp, body);
  assert.equal(verifyWebhookSignature(secret, timestamp, body, signature), true);
  assert.equal(verifyWebhookSignature(secret, timestamp, `${body} `, signature), false);
  assert.equal(verifyWebhookSignature(secret, String(Number(timestamp) - 600), body, signature), false);
});

test("expired orders cannot be settled", () => {
  const store = new GatewayStore(":memory:");
  const id = "00000000-0000-4000-8000-000000000001";
  const expiredAt = new Date(Date.now() - 1000).toISOString();
  store.createReservation({
    id,
    merchant_reference: "EXPIRED-001",
    amount: 1000,
    description: "Expired test",
    provider: "sandbox",
    expires_at: expiredAt,
  });
  store.activatePayment(id, { reference: "expired-ref", checkoutUrl: "http://localhost/checkout" });
  store.expireDuePayments();
  const result = store.transitionPayment(id, "paid");
  assert.equal(result.payment.status, "expired");
  assert.equal(result.changed, false);
  store.close();
});

test("merchant webhooks are signed and acknowledged", async (t) => {
  const secret = "merchant-webhook-secret-".padEnd(64, "d");
  let received;
  let acknowledge;
  const receivedEvent = new Promise((resolve) => { acknowledge = resolve; });
  const callbackServer = createHttpServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = {
      body: Buffer.concat(chunks).toString("utf8"),
      timestamp: /t=(\d+)/.exec(request.headers["x-rapiqr-signature"] || "")?.[1],
      signature: /v1=([a-f0-9]+)/.exec(request.headers["x-rapiqr-signature"] || "")?.[1],
      eventId: request.headers["x-rapiqr-event-id"],
    };
    response.writeHead(204);
    response.end();
    acknowledge();
  });
  const callbackOrigin = await listen(callbackServer);
  const store = new GatewayStore(":memory:", `${callbackOrigin}/hook`);
  const paymentId = "00000000-0000-4000-8000-000000000002";
  store.createReservation({
    id: paymentId,
    merchant_reference: "HOOK-001",
    amount: 20_000,
    description: "Webhook test",
    provider: "sandbox",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  store.activatePayment(paymentId, { reference: "sandbox-hook-001", checkoutUrl: `${callbackOrigin}/checkout` });
  const { createWebhookWorker } = await import("../src/webhook-worker.js");
  const worker = createWebhookWorker({ store, url: `${callbackOrigin}/hook`, secret, logger: { error() {} } });
  t.after(async () => {
    worker.stop();
    await close(callbackServer);
    store.close();
  });

  await Promise.race([
    receivedEvent,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Webhook tidak diterima tepat waktu.")), 1500)),
  ]);
  const deliveryDeadline = Date.now() + 1000;
  while (store.webhookSummary().pending !== 0 && Date.now() < deliveryDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(verifyWebhookSignature(secret, received.timestamp, received.body, received.signature), true);
  assert.ok(received.eventId);
  assert.equal(store.webhookSummary().pending, 0);
  assert.equal(store.webhookSummary().failed, 0);
});
