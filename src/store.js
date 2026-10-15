import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const terminalStatuses = new Set(["paid", "expired", "cancelled", "failed"]);

export function publicPayment(row) {
  if (!row) return null;
  return {
    id: row.id,
    merchant_reference: row.merchant_reference,
    amount: row.amount,
    currency: row.currency,
    description: row.description,
    status: row.status,
    provider: row.provider,
    provider_reference: row.provider_reference,
    checkout_url: row.checkout_url,
    expires_at: row.expires_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    paid_at: row.paid_at,
  };
}

export class GatewayStore {
  constructor(databasePath = ":memory:", webhookUrl = "") {
    if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
    this.webhookUrl = webhookUrl;
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA foreign_keys = ON;");
    if (databasePath !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        merchant_reference TEXT NOT NULL UNIQUE,
        amount INTEGER NOT NULL CHECK (amount > 0),
        currency TEXT NOT NULL DEFAULT 'IDR' CHECK (currency = 'IDR'),
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('creating','pending','paid','expired','cancelled','failed')),
        provider TEXT NOT NULL,
        provider_reference TEXT UNIQUE,
        checkout_url TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        paid_at TEXT,
        failure_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS payments_status_expiry_idx ON payments(status, expires_at);
      CREATE INDEX IF NOT EXISTS payments_created_idx ON payments(created_at DESC);

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        payment_id TEXT NOT NULL REFERENCES payments(id),
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_payment_idx ON events(payment_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE REFERENCES events(id),
        status TEXT NOT NULL CHECK (status IN ('pending','delivered','failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        response_code INTEGER,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS webhook_due_idx ON webhook_deliveries(status, next_attempt_at);
    `);
  }

  createReservation(payment) {
    const existing = this.getByMerchantReference(payment.merchant_reference);
    if (existing) return { created: false, payment: existing };

    const now = new Date().toISOString();
    try {
      this.db.prepare(`
        INSERT INTO payments (
          id, merchant_reference, amount, currency, description, status, provider,
          expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, 'IDR', ?, 'creating', ?, ?, ?, ?)
      `).run(payment.id, payment.merchant_reference, payment.amount, payment.description, payment.provider, payment.expires_at, now, now);
      return { created: true, payment: this.getPayment(payment.id) };
    } catch (error) {
      if (String(error.message).includes("UNIQUE constraint failed: payments.merchant_reference")) {
        return { created: false, payment: this.getByMerchantReference(payment.merchant_reference) };
      }
      throw error;
    }
  }

  activatePayment(id, providerResult) {
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const row = this.getPayment(id);
      if (!row || row.status !== "creating") throw new Error("Pembayaran tidak berada pada status creating.");
      this.db.prepare(`
        UPDATE payments SET status='pending', provider_reference=?, checkout_url=?, updated_at=? WHERE id=?
      `).run(providerResult.reference, providerResult.checkoutUrl, now, id);
      const payment = this.getPayment(id);
      this.appendEvent(payment, "payment.pending");
      this.db.exec("COMMIT;");
      return payment;
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  failCreation(id, reason) {
    const row = this.getPayment(id);
    if (!row || row.status !== "creating") return row;
    const now = new Date().toISOString();
    this.db.prepare("UPDATE payments SET status='failed', failure_reason=?, updated_at=? WHERE id=?")
      .run(String(reason).slice(0, 500), now, id);
    const payment = this.getPayment(id);
    this.appendEvent(payment, "payment.failed");
    return payment;
  }

  transitionPayment(id, nextStatus, details = {}) {
    if (!terminalStatuses.has(nextStatus)) throw new Error("Status akhir pembayaran tidak valid.");
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const row = this.getPayment(id);
      if (!row) {
        this.db.exec("COMMIT;");
        return { changed: false, payment: null };
      }
      if (row.status === nextStatus) {
        this.db.exec("COMMIT;");
        return { changed: false, payment: row };
      }
      if (row.status !== "pending") {
        this.db.exec("COMMIT;");
        return { changed: false, payment: row };
      }
      const now = new Date().toISOString();
      const paidAt = nextStatus === "paid" ? now : row.paid_at;
      this.db.prepare(`
        UPDATE payments SET status=?, updated_at=?, paid_at=?, failure_reason=? WHERE id=?
      `).run(nextStatus, now, paidAt, details.reason ? String(details.reason).slice(0, 500) : row.failure_reason, id);
      const payment = this.getPayment(id);
      this.appendEvent(payment, `payment.${nextStatus}`);
      this.db.exec("COMMIT;");
      return { changed: true, payment };
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  appendEvent(payment, type) {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const payload = {
      id,
      type,
      created_at: createdAt,
      data: { object: publicPayment(payment) },
    };
    this.db.prepare("INSERT INTO events (id, payment_id, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, payment.id, type, JSON.stringify(payload), createdAt);
    if (this.webhookUrl) {
      this.db.prepare(`
        INSERT INTO webhook_deliveries (id, event_id, status, next_attempt_at, created_at, updated_at)
        VALUES (?, ?, 'pending', ?, ?, ?)
      `).run(randomUUID(), id, createdAt, createdAt, createdAt);
    }
  }

  getPayment(id) {
    return this.db.prepare("SELECT * FROM payments WHERE id=?").get(id) || null;
  }

  getByMerchantReference(reference) {
    return this.db.prepare("SELECT * FROM payments WHERE merchant_reference=?").get(reference) || null;
  }

  getByProviderReference(reference) {
    return this.db.prepare("SELECT * FROM payments WHERE provider_reference=?").get(reference) || null;
  }

  expireDuePayments(now = new Date().toISOString()) {
    const due = this.db.prepare("SELECT id FROM payments WHERE status='pending' AND expires_at <= ? LIMIT 100")
      .all(now);
    for (const row of due) this.transitionPayment(row.id, "expired");
    return due.length;
  }

  listPayments(limit = 25) {
    return this.db.prepare("SELECT * FROM payments ORDER BY created_at DESC LIMIT ?").all(limit);
  }

  listEvents(limit = 12) {
    return this.db.prepare(`
      SELECT e.id, e.type, e.created_at, p.merchant_reference
      FROM events e JOIN payments p ON p.id=e.payment_id
      ORDER BY e.created_at DESC LIMIT ?
    `).all(limit);
  }

  dashboard() {
    const stats = this.db.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) AS paid,
        SUM(CASE WHEN status='paid' THEN amount ELSE 0 END) AS paid_amount
      FROM payments
    `).get();
    return {
      stats: {
        total: stats.total || 0,
        pending: stats.pending || 0,
        paid: stats.paid || 0,
        paid_amount: stats.paid_amount || 0,
      },
      payments: this.listPayments(25).map(publicPayment),
      events: this.listEvents(12),
    };
  }

  dueDeliveries(now = new Date().toISOString(), limit = 10) {
    return this.db.prepare(`
      SELECT d.*, e.payload_json
      FROM webhook_deliveries d JOIN events e ON e.id=d.event_id
      WHERE d.status='pending' AND d.next_attempt_at <= ?
      ORDER BY d.created_at LIMIT ?
    `).all(now, limit);
  }

  finishDelivery(id, { delivered, responseCode = null, error = null, nextAttemptAt = null, attempts }) {
    const now = new Date().toISOString();
    const status = delivered ? "delivered" : nextAttemptAt ? "pending" : "failed";
    this.db.prepare(`
      UPDATE webhook_deliveries
      SET status=?, attempts=?, next_attempt_at=?, response_code=?, last_error=?, updated_at=?
      WHERE id=?
    `).run(status, attempts, nextAttemptAt || now, responseCode, error ? String(error).slice(0, 500) : null, now, id);
  }

  webhookSummary() {
    return this.db.prepare(`
      SELECT
        SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed
      FROM webhook_deliveries
    `).get();
  }

  close() {
    this.db.close();
  }
}
