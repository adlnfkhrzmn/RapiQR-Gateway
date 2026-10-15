import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

export function loadConfig() {
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT || 3000);
  const configuredDbPath = process.env.DATABASE_PATH || "./data/rapiqr.sqlite";
  const databasePath = configuredDbPath === ":memory:" ? ":memory:" : resolve(projectRoot, configuredDbPath);
  const nodeEnv = process.env.NODE_ENV || "development";
  const publicOriginValue = process.env.PUBLIC_ORIGIN || `http://${host}:${port}`;
  let publicOrigin;
  try {
    const parsedOrigin = new URL(publicOriginValue);
    if (!(["http:", "https:"].includes(parsedOrigin.protocol)) || parsedOrigin.username || parsedOrigin.password || parsedOrigin.pathname !== "/" || parsedOrigin.search || parsedOrigin.hash) {
      throw new Error("invalid_origin");
    }
    if (nodeEnv === "production" && parsedOrigin.protocol !== "https:") throw new Error("production_requires_https");
    publicOrigin = parsedOrigin.origin;
  } catch {
    throw new Error("PUBLIC_ORIGIN harus berupa origin HTTP/HTTPS tanpa path; production wajib memakai HTTPS.");
  }
  const config = {
    nodeEnv,
    host,
    port,
    providerName: process.env.PAYMENT_PROVIDER?.trim() || null,
    apiKey: process.env.RAPIQR_API_KEY || "",
    webhookSecret: process.env.WEBHOOK_SECRET || "",
    webhookUrl: process.env.WEBHOOK_URL || "",
    publicOrigin,
    databasePath,
    maxAmount: 10_000_000,
    defaultExpirySeconds: 900,
  };

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT harus berupa angka antara 1 dan 65535.");
  }
  if (config.apiKey.length < 32) {
    throw new Error("RAPIQR_API_KEY belum diatur atau terlalu pendek. Jalankan npm run setup.");
  }
  if (config.providerName && !/^[a-z0-9-]+$/.test(config.providerName)) {
    throw new Error("PAYMENT_PROVIDER hanya boleh berisi huruf kecil, angka, atau tanda hubung.");
  }
  if (config.webhookUrl) {
    let webhookUrl;
    try {
      webhookUrl = new URL(config.webhookUrl);
    } catch {
      throw new Error("WEBHOOK_URL harus berupa URL yang valid.");
    }
    const localHttp = nodeEnv !== "production" && ["127.0.0.1", "localhost"].includes(webhookUrl.hostname) && webhookUrl.protocol === "http:";
    if (webhookUrl.protocol !== "https:" && !localHttp) {
      throw new Error("WEBHOOK_URL harus menggunakan HTTPS. HTTP hanya diizinkan untuk localhost saat development.");
    }
    if (config.webhookSecret.length < 32) {
      throw new Error("WEBHOOK_SECRET wajib berisi minimal 32 karakter jika WEBHOOK_URL diatur.");
    }
  }
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  return Object.freeze(config);
}
