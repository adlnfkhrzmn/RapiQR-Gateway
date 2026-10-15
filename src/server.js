import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { GatewayStore, publicPayment } from "./store.js";
import { hasValidApiKey } from "./security.js";
import { createWebhookWorker } from "./webhook-worker.js";
import { loadConfig } from "./config.js";

const publicDirectory = fileURLToPath(new URL("../public/", import.meta.url));
const assetFiles = new Map([
  ["/assets/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/assets/dashboard.js", ["dashboard.js", "text/javascript; charset=utf-8"]],
]);
const requestWindows = new Map();
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;

class HttpError extends Error {
  constructor(status, message, code = "request_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sendJson(response, status, payload, requestId) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-request-id": requestId,
  });
  response.end(body);
}

function sendHtml(response, status, html, requestId) {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html),
    "cache-control": "no-store",
    "x-request-id": requestId,
  });
  response.end(html);
}

function addSecurityHeaders(response) {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("content-security-policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
}

async function readJson(request, limit = 32 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "Ukuran request terlalu besar.", "payload_too_large");
    chunks.push(chunk);
  }
  const rawBody = Buffer.concat(chunks).toString("utf8");
  if (!rawBody) return { rawBody, body: {} };
  try {
    return { rawBody, body: JSON.parse(rawBody) };
  } catch {
    throw new HttpError(400, "Body harus berupa JSON yang valid.", "invalid_json");
  }
}

function allowRequest(request) {
  const address = request.socket.remoteAddress || "unknown";
  const now = Date.now();
  let window = requestWindows.get(address);
  if (!window || now - window.start >= RATE_WINDOW_MS) {
    window = { start: now, count: 0 };
    requestWindows.set(address, window);
  }
  window.count += 1;
  if (requestWindows.size > 5000) {
    for (const [key, item] of requestWindows) {
      if (now - item.start > RATE_WINDOW_MS) requestWindows.delete(key);
    }
  }
  return window.count <= RATE_LIMIT;
}

function requireAuth(request, config) {
  if (!hasValidApiKey(request, config.apiKey)) {
    throw new HttpError(401, "API key tidak valid atau belum dikirim.", "unauthorized");
  }
}

function validatePaymentInput(body, config) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Body pembayaran harus berupa object JSON.", "invalid_body");
  }
  const reference = body.merchant_reference;
  if (typeof reference !== "string" || !/^[A-Za-z0-9._:-]{1,100}$/.test(reference)) {
    throw new HttpError(400, "merchant_reference wajib 1–100 karakter dan hanya boleh berisi huruf, angka, titik, garis bawah, titik dua, atau tanda hubung.", "invalid_reference");
  }
  if (!Number.isSafeInteger(body.amount) || body.amount < 1 || body.amount > config.maxAmount) {
    throw new HttpError(400, `amount harus berupa bilangan bulat antara 1 dan ${config.maxAmount}.`, "invalid_amount");
  }
  const currency = body.currency || "IDR";
  if (currency !== "IDR") throw new HttpError(400, "Saat ini hanya mata uang IDR yang didukung.", "unsupported_currency");
  const description = body.description === undefined ? "" : body.description;
  if (typeof description !== "string" || description.length > 200) {
    throw new HttpError(400, "description maksimal 200 karakter.", "invalid_description");
  }
  const expiry = body.expires_in_seconds === undefined ? config.defaultExpirySeconds : body.expires_in_seconds;
  if (!Number.isInteger(expiry) || expiry < 60 || expiry > 86_400) {
    throw new HttpError(400, "expires_in_seconds harus antara 60 dan 86400.", "invalid_expiry");
  }
  return { merchant_reference: reference, amount: body.amount, currency, description, expiry };
}

function paymentResponse(payment, { idempotent = false } = {}) {
  return { ...publicPayment(payment), idempotent };
}

function normalizeProviderStatus(status) {
  const value = String(status || "").toLowerCase();
  if (["paid", "success", "successful", "settlement", "settled"].includes(value)) return "paid";
  if (["expire", "expired"].includes(value)) return "expired";
  if (["cancel", "cancelled", "canceled"].includes(value)) return "cancelled";
  if (["deny", "denied", "fail", "failed", "failure"].includes(value)) return "failed";
  return null;
}

async function loadProvider(name) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error("Nama provider hanya boleh berisi huruf kecil, angka, atau tanda hubung.");
  const providerModule = await import(new URL(`./providers/${name}.js`, import.meta.url));
  const provider = providerModule.default;
  if (!provider || typeof provider.createPayment !== "function") {
    throw new Error(`Provider ${name} harus menyediakan createPayment().`);
  }
  if (typeof provider.normalizeWebhook !== "function" && typeof provider.start !== "function") {
    throw new Error(`Provider ${name} harus menyediakan normalizeWebhook() atau start() untuk memperbarui status pembayaran.`);
  }
  return provider;
}

async function serveAsset(response, path, requestId) {
  const [fileName, contentType] = assetFiles.get(path);
  const filePath = resolve(publicDirectory, fileName);
  const data = await readFile(filePath);
  response.writeHead(200, {
    "content-type": contentType,
    "content-length": data.length,
    "cache-control": "public, max-age=300",
    "x-request-id": requestId,
  });
  response.end(data);
}

async function handleRequest(request, response, context) {
  const { config, store, provider } = context;
  const requestId = randomUUID();
  addSecurityHeaders(response);
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  if (request.method === "GET" && pathname === "/") {
    return sendHtml(response, 200, await readFile(resolve(publicDirectory, "dashboard.html"), "utf8"), requestId);
  }
  if (request.method === "GET" && assetFiles.has(pathname)) return serveAsset(response, pathname, requestId);

  if (request.method === "GET" && pathname === "/api/v1/health") {
    return sendJson(response, 200, {
      ok: true,
      service: "rapiqr-gateway",
      ready: Boolean(provider),
      provider: provider?.name || null,
      mode: provider ? "provider-configured" : "provider-unconfigured",
      time: new Date().toISOString(),
    }, requestId);
  }

  const providerWebhookMatch = /^\/api\/v1\/providers\/([a-z0-9-]+)\/webhook$/.exec(pathname);
  if (request.method === "POST" && providerWebhookMatch) {
    if (!allowRequest(request)) throw new HttpError(429, "Terlalu banyak request.", "rate_limited");
    const providerName = providerWebhookMatch[1];
    if (!provider) throw new HttpError(503, "Adapter provider belum dikonfigurasi.", "provider_not_configured");
    if (providerName !== provider.name) throw new HttpError(404, "Provider tidak aktif.", "provider_not_found");
    if (typeof provider.normalizeWebhook !== "function") throw new HttpError(501, "Adapter provider ini tidak menerima webhook.", "webhook_not_supported");
    const { rawBody } = await readJson(request);
    let normalized;
    try {
      normalized = await provider.normalizeWebhook({ rawBody, headers: request.headers, config });
    } catch {
      throw new HttpError(401, "Signature webhook tidak valid atau format event tidak didukung.", "invalid_provider_webhook");
    }
    if (!normalized || typeof normalized.reference !== "string") {
      throw new HttpError(400, "Webhook provider tidak mengembalikan reference yang valid.", "invalid_provider_event");
    }
    const payment = store.getByProviderReference(normalized.reference);
    if (!payment) throw new HttpError(404, "Pembayaran untuk reference tersebut tidak ditemukan.", "payment_not_found");
    const nextStatus = normalizeProviderStatus(normalized.status);
    if (!nextStatus) throw new HttpError(400, "Status transaksi provider tidak dikenal.", "invalid_provider_status");
    const result = store.transitionPayment(payment.id, nextStatus, { reason: normalized.reason });
    return sendJson(response, 200, { received: true, changed: result.changed, data: publicPayment(result.payment) }, requestId);
  }

  if (pathname.startsWith("/api/v1/")) {
    if (!allowRequest(request)) throw new HttpError(429, "Terlalu banyak request. Coba lagi sebentar.", "rate_limited");
    requireAuth(request, config);

    if (request.method === "GET" && pathname === "/api/v1/dashboard") {
      store.expireDuePayments();
      return sendJson(response, 200, { data: { ...store.dashboard(), provider: provider?.name || null }, webhooks: store.webhookSummary() }, requestId);
    }

    if (request.method === "GET" && pathname === "/api/v1/payments") {
      const requestedLimit = url.searchParams.get("limit");
      const parsedLimit = requestedLimit === null ? 25 : Number(requestedLimit);
      if (!Number.isInteger(parsedLimit)) throw new HttpError(400, "limit harus berupa bilangan bulat.", "invalid_limit");
      const limit = Math.max(1, Math.min(100, parsedLimit));
      return sendJson(response, 200, { data: store.listPayments(limit).map(publicPayment) }, requestId);
    }

    if (request.method === "POST" && pathname === "/api/v1/payments") {
      if (!provider) throw new HttpError(503, "Tambahkan dan aktifkan adapter provider sebelum membuat pembayaran.", "provider_not_configured");
      const { body } = await readJson(request);
      const input = validatePaymentInput(body, config);
      const existing = store.getByMerchantReference(input.merchant_reference);
      if (existing) {
        if (existing.amount !== input.amount || existing.currency !== input.currency) {
          throw new HttpError(409, "merchant_reference sudah dipakai untuk nominal atau mata uang lain.", "idempotency_conflict");
        }
        return sendJson(response, existing.status === "creating" ? 202 : 200, { data: paymentResponse(existing, { idempotent: true }) }, requestId);
      }

      const id = randomUUID();
      const expiresAt = new Date(Date.now() + input.expiry * 1000).toISOString();
      const reservation = store.createReservation({
        id,
        merchant_reference: input.merchant_reference,
        amount: input.amount,
        description: input.description,
        provider: provider.name,
        expires_at: expiresAt,
      });
      if (!reservation.created) {
        const payment = reservation.payment;
        if (!payment || payment.amount !== input.amount) throw new HttpError(409, "merchant_reference baru saja digunakan oleh request lain.", "idempotency_conflict");
        return sendJson(response, 200, { data: paymentResponse(payment, { idempotent: true }) }, requestId);
      }

      try {
        const providerResult = await provider.createPayment({
          id,
          merchantReference: input.merchant_reference,
          amount: input.amount,
          currency: input.currency,
          description: input.description,
          expiresAt,
        }, { publicOrigin: config.publicOrigin, config });
        const checkoutUrl = new URL(providerResult.checkoutUrl);
        const localHttpCheckout = config.nodeEnv !== "production"
          && checkoutUrl.protocol === "http:"
          && ["127.0.0.1", "localhost"].includes(checkoutUrl.hostname);
        if (checkoutUrl.protocol !== "https:" && !localHttpCheckout) throw new Error("Provider harus mengembalikan checkout URL HTTPS.");
        const payment = store.activatePayment(id, {
          reference: providerResult.reference,
          checkoutUrl: checkoutUrl.toString(),
        });
        return sendJson(response, 201, { data: paymentResponse(payment) }, requestId);
      } catch (error) {
        store.failCreation(id, error.message);
        throw new HttpError(502, "Provider gagal membuat pembayaran. Periksa konfigurasi adapter dan log server.", "provider_error");
      }
    }

    const paymentRoute = /^\/api\/v1\/payments\/([0-9a-f-]{36})(?:\/(cancel))?$/.exec(pathname);
    if (paymentRoute) {
      const [, id, action] = paymentRoute;
      store.expireDuePayments();
      const payment = store.getPayment(id);
      if (!payment) throw new HttpError(404, "Pembayaran tidak ditemukan.", "payment_not_found");
      if (request.method === "GET" && !action) return sendJson(response, 200, { data: publicPayment(payment) }, requestId);
      if (request.method === "POST" && action === "cancel") {
        const result = store.transitionPayment(id, "cancelled");
        if (!result.changed && result.payment.status !== "cancelled") {
          throw new HttpError(409, `Pembayaran berstatus ${result.payment.status} dan tidak dapat dibatalkan.`, "invalid_transition");
        }
        return sendJson(response, 200, { data: publicPayment(result.payment), changed: result.changed }, requestId);
      }
    }
  }

  throw new HttpError(404, "Rute tidak ditemukan.", "not_found");
}

export function createGatewayServer({ config, store, provider, logger = console }) {
  const context = { config, store, provider };
  return createServer(async (request, response) => {
    try {
      await handleRequest(request, response, context);
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const requestId = response.getHeader("x-request-id") || randomUUID();
      const status = error instanceof HttpError ? error.status : 500;
      if (status >= 500) logger.error(`[${requestId}] ${error.message}`);
      sendJson(response, status, {
        error: {
          code: error instanceof HttpError ? error.code : "internal_error",
          message: status >= 500 ? "Terjadi kesalahan internal." : error.message,
          request_id: requestId,
        },
      }, requestId);
    }
  });
}

export async function start() {
  const config = loadConfig();
  const provider = config.providerName ? await loadProvider(config.providerName) : null;
  const store = new GatewayStore(config.databasePath, config.webhookUrl);
  const server = createGatewayServer({ config, store, provider });
  const webhookWorker = createWebhookWorker({ store, url: config.webhookUrl, secret: config.webhookSecret });
  let stopProvider = null;
  try {
    const providerRuntime = await provider?.start?.({ store, config, logger: console });
    if (providerRuntime !== undefined && providerRuntime !== null) {
      if (typeof providerRuntime !== "function") throw new Error("provider.start() harus mengembalikan fungsi cleanup atau tidak mengembalikan nilai.");
      stopProvider = providerRuntime;
    }
  } catch (error) {
    webhookWorker.stop();
    store.close();
    throw error;
  }
  const expiryTimer = setInterval(() => store.expireDuePayments(), 15_000);
  expiryTimer.unref();

  server.listen(config.port, config.host, () => {
    console.log(`RapiQR Gateway berjalan di http://${config.host}:${config.port}`);
    console.log(provider ? `Adapter provider aktif: ${provider.name}` : "Adapter provider belum dikonfigurasi; endpoint pembayaran belum aktif.");
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(expiryTimer);
    webhookWorker.stop();
    try {
      await stopProvider?.();
    } catch (error) {
      console.error(`Adapter provider gagal dihentikan dengan bersih: ${error.message}`);
    }
    server.close(() => {
      store.close();
      process.exit(0);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return { server, store, webhookWorker };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().catch((error) => {
    console.error(`RapiQR Gateway gagal dijalankan: ${error.message}`);
    process.exitCode = 1;
  });
}
