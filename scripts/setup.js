import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envPath = fileURLToPath(new URL("../.env", import.meta.url));

if (existsSync(envPath)) {
  console.error("File .env sudah ada. Tidak ada yang diubah.");
  process.exit(1);
}

const apiKey = randomBytes(32).toString("base64url");
const webhookSecret = randomBytes(32).toString("base64url");
const contents = [
  "NODE_ENV=development",
  "HOST=127.0.0.1",
  "PORT=3000",
  "PAYMENT_PROVIDER=",
  `RAPIQR_API_KEY=${apiKey}`,
  `WEBHOOK_SECRET=${webhookSecret}`,
  "WEBHOOK_URL=",
  "PUBLIC_ORIGIN=http://127.0.0.1:3000",
  "DATABASE_PATH=./data/rapiqr.sqlite",
  "",
].join("\n");

writeFileSync(envPath, contents, { flag: "wx", mode: 0o600 });
console.log("Konfigurasi lokal berhasil dibuat di .env.");
console.log("Simpan API key ini untuk membuka dashboard:");
console.log(apiKey);
console.log("Tambahkan adapter provider pilihanmu, lalu jalankan aplikasi dengan: npm run dev");
