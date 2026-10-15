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
  const config = {
    nodeEnv,
    host,
    port,
    providerName: process.env.PAYMENT_PROVIDER || "sandbox",
    apiKey: process.env.RAPIQR_API_KEY || "",
    webhookSecret: process.env.WEBHOOK_SECRET || "",
    webhookUrl: process.env.WEBHOOK_URL || "",
    publicOrigin: (process.env.PUBLIC_ORIGIN || `http://${host}:${port}`).replace(/\/$/, ""),
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
  if (nodeEnv === "production" && config.providerName === "sandbox") {
    throw new Error("Provider sandbox tidak boleh dijalankan saat NODE_ENV=production.");
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
