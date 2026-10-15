import { createHmac, timingSafeEqual } from "node:crypto";

export function hasValidApiKey(request, apiKey) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.authorization || "");
  if (!match) return false;
  const supplied = Buffer.from(match[1]);
  const expected = Buffer.from(apiKey);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function signWebhook(secret, timestamp, body) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function verifyWebhookSignature(secret, timestamp, body, signature) {
  if (!/^\d{10,13}$/.test(String(timestamp)) || !/^[a-f0-9]{64}$/i.test(String(signature))) return false;
  const time = Number(timestamp);
  const now = Date.now();
  const timeInMilliseconds = String(timestamp).length === 10 ? time * 1000 : time;
  if (Math.abs(now - timeInMilliseconds) > 5 * 60 * 1000) return false;
  const expected = Buffer.from(signWebhook(secret, timestamp, body), "hex");
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
