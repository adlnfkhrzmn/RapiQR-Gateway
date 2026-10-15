import { signWebhook } from "./security.js";

const retryDelays = [10_000, 30_000, 120_000, 600_000];

export function createWebhookWorker({ store, url, secret, logger = console }) {
  let busy = false;

  async function deliverDue() {
    if (!url || busy) return;
    busy = true;
    try {
      for (const delivery of store.dueDeliveries()) {
        const attempts = delivery.attempts + 1;
        const timestamp = String(Math.floor(Date.now() / 1000));
        const signature = signWebhook(secret, timestamp, delivery.payload_json);
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-rapiqr-event-id": delivery.event_id,
              "x-rapiqr-signature": `t=${timestamp},v1=${signature}`,
            },
            body: delivery.payload_json,
            signal: AbortSignal.timeout(5000),
          });
          const delivered = response.status >= 200 && response.status < 300;
          const delay = retryDelays[attempts - 1];
          store.finishDelivery(delivery.id, {
            delivered,
            attempts,
            responseCode: response.status,
            error: delivered ? null : `Endpoint membalas HTTP ${response.status}`,
            nextAttemptAt: delivered || !delay ? null : new Date(Date.now() + delay).toISOString(),
          });
        } catch (error) {
          const delay = retryDelays[attempts - 1];
          store.finishDelivery(delivery.id, {
            delivered: false,
            attempts,
            error: error.message,
            nextAttemptAt: delay ? new Date(Date.now() + delay).toISOString() : null,
          });
        }
      }
    } catch (error) {
      logger.error("Webhook worker gagal memproses antrean:", error.message);
    } finally {
      busy = false;
    }
  }

  const timer = setInterval(deliverDue, 5000);
  timer.unref();
  void deliverDue();

  return {
    deliverDue,
    stop() {
      clearInterval(timer);
    },
  };
}
