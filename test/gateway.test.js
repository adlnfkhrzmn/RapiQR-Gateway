import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer as createHttpServer } from "node:http";
import { createGatewayServer } from "../src/server.js";
import { GatewayStore } from "../src/store.js";
import { signWebhook, verifyWebhookSignature } from "../src/security.js";
import { loadConfig } from "../src/config.js";

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
    providerName: "test-provider",
    webhookSecret: "test-webhook-secret-".padEnd(64, "b"),
    webhookUrl: "",
    publicOrigin: "http://127.0.0.1",
    maxAmount: 10_000_000,
    defaultExpirySeconds: 900,
    ...overrides,
  };
}

test("production config requires an HTTPS public origin and permits no default provider", () => {
  const keys = ["NODE_ENV", "HOST", "PORT", "PAYMENT_PROVIDER", "RAPIQR_API_KEY", "PUBLIC_ORIGIN", "DATABASE_PATH"];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: "3000",
    PAYMENT_PROVIDER: "",
    RAPIQR_API_KEY: apiKey,
    PUBLIC_ORIGIN: "http://gateway.example.test",
    DATABASE_PATH: ":memory:",
  });
  try {
    assert.throws(() => loadConfig(), /production wajib memakai HTTPS/);
    process.env.PUBLIC_ORIGIN = "https://gateway.example.test";
    const config = loadConfig();
    assert.equal(config.providerName, null);
    assert.equal(config.publicOrigin, "https://gateway.example.test");
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
});

test("provider-neutral order lifecycle and API access", async (t) => {
  const store = new GatewayStore(":memory:");
  const config = createConfig();
  const provider = {
    name: "test-provider",
    async createPayment(payment) {
      return { reference: `test-${payment.id}`, checkoutUrl: "https://checkout.example.test/order" };
    },
    async normalizeWebhook() {
      throw new Error("Not used in this test.");
    },
  };
  const server = createGatewayServer({ config, store, provider, logger: { error() {} } });
  const origin = await listen(server);
  config.publicOrigin = origin;
  t.after(async () => {
    await close(server);
    store.close();
  });

  const health = await fetch(`${origin}/api/v1/health`).then((response) => response.json());
  assert.equal(health.ok, true);
  assert.equal(health.provider, "test-provider");
  assert.equal(health.ready, true);

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
  assert.equal(new URL(created.data.checkout_url).origin, "https://checkout.example.test");

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

  const dashboard = await fetch(`${origin}/api/v1/dashboard`, { headers: { authorization: `Bearer ${apiKey}` } }).then((response) => response.json());
  assert.equal(dashboard.data.stats.total, 1);
  assert.equal(dashboard.data.stats.pending, 1);
  assert.equal(dashboard.data.stats.paid_amount, 0);

  const cancelPending = await fetch(`${origin}/api/v1/payments/${created.data.id}/cancel`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
  });
  assert.equal(cancelPending.status, 200);

  const noQueryKey = await fetch(`${origin}/api/v1/dashboard?api_key=${apiKey}`);
  assert.equal(noQueryKey.status, 401);
});

test("unconfigured provider keeps the dashboard available and rejects payment creation", async (t) => {
  const store = new GatewayStore(":memory:");
  const config = createConfig({ providerName: null });
  const server = createGatewayServer({ config, store, provider: null, logger: { error() {} } });
  const origin = await listen(server);
  t.after(async () => {
    await close(server);
    store.close();
  });

  const health = await fetch(`${origin}/api/v1/health`).then((response) => response.json());
  assert.equal(health.ok, true);
  assert.equal(health.ready, false);
  assert.equal(health.provider, null);

  const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
  const dashboard = await fetch(`${origin}/api/v1/dashboard`, { headers }).then((response) => response.json());
  assert.equal(dashboard.data.provider, null);

  const response = await fetch(`${origin}/api/v1/payments`, {
    method: "POST",
    headers,
    body: JSON.stringify({ merchant_reference: "NO-ADAPTER-001", amount: 10_000 }),
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "provider_not_configured");
});

test("polling-only provider does not expose an unhandled webhook route", async (t) => {
  const store = new GatewayStore(":memory:");
  const provider = {
    name: "poll-provider",
    async createPayment() {
      return { reference: "poll-001", checkoutUrl: "https://checkout.example.test/order" };
    },
    async start() {},
  };
  const config = createConfig({ providerName: "poll-provider" });
  const server = createGatewayServer({ config, store, provider, logger: { error() {} } });
  const origin = await listen(server);
  t.after(async () => {
    await close(server);
    store.close();
  });

  const response = await fetch(origin + "/api/v1/providers/poll-provider/webhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 501);
  assert.equal((await response.json()).error.code, "webhook_not_supported");
});

test("production only accepts HTTPS provider checkout URLs", async (t) => {
  const store = new GatewayStore(":memory:");
  const provider = {
    name: "insecure-provider",
    async createPayment() {
      return { reference: "insecure-001", checkoutUrl: "http://checkout.example.test/order" };
    },
    async normalizeWebhook() {
      return null;
    },
  };
  const config = createConfig({ nodeEnv: "production", providerName: provider.name });
  const server = createGatewayServer({ config, store, provider, logger: { error() {} } });
  const origin = await listen(server);
  t.after(async () => {
    await close(server);
    store.close();
  });

  const response = await fetch(origin + "/api/v1/payments", {
    method: "POST",
    headers: { authorization: "Bearer " + apiKey, "content-type": "application/json" },
    body: JSON.stringify({ merchant_reference: "TLS-001", amount: 10_000 }),
  });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, "provider_error");
  assert.equal(store.getByMerchantReference("TLS-001").status, "failed");
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
    provider: "test-provider",
    expires_at: expiredAt,
  });
  store.activatePayment(id, { reference: "expired-ref", checkoutUrl: "https://checkout.example.test/order" });
  store.expireDuePayments();
  const result = store.transitionPayment(id, "paid");
  assert.equal(result.payment.status, "expired");
  assert.equal(result.changed, false);
  store.close();
});

test("provider reconciliation can read only pending orders for its adapter", () => {
  const store = new GatewayStore(":memory:");
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  for (const [id, reference, providerName] of [
    ["00000000-0000-4000-8000-000000000011", "POLL-001", "poll-provider"],
    ["00000000-0000-4000-8000-000000000012", "OTHER-001", "other-provider"],
  ]) {
    store.createReservation({ id, merchant_reference: reference, amount: 1000, description: "", provider: providerName, expires_at: expiresAt });
    store.activatePayment(id, { reference: `${providerName}-${id}`, checkoutUrl: "https://checkout.example.test/order" });
  }
  assert.equal(store.listPendingPayments("poll-provider").length, 1);
  assert.equal(store.listPendingPayments("missing-provider").length, 0);
  assert.throws(() => store.listPendingPayments("poll-provider", 0), /antara 1 dan 500/);
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
    provider: "test-provider",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  store.activatePayment(paymentId, { reference: "provider-hook-001", checkoutUrl: `${callbackOrigin}/checkout` });
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
