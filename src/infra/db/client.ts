import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export interface AppDatabase {
  raw: Database.Database;
  migrate(): void;
  transaction<T>(fn: () => T): T;
  resetForDemo(): void;
  close(): void;
}

const MIGRATIONS_SQL = `
CREATE TABLE IF NOT EXISTS mandates (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
  source_text TEXT NOT NULL,
  monthly_cap_cents INTEGER NOT NULL,
  auto_approve_limit_cents INTEGER NOT NULL,
  hard_limit_cents INTEGER NOT NULL,
  allowed_categories_json TEXT NOT NULL,
  blocked_merchants_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  activated_at TEXT
);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  mandate_id TEXT,
  product_id TEXT NOT NULL,
  title TEXT NOT NULL,
  merchant TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_approval', 'approved', 'captured', 'rejected', 'denied', 'failed')),
  policy_decision_json TEXT NOT NULL,
  paypal_order_id TEXT,
  paypal_approval_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  captured_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_purchases_status_captured_at
  ON purchases(status, captured_at);

CREATE INDEX IF NOT EXISTS idx_purchases_paypal_order_id
  ON purchases(paypal_order_id);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  timestamp TEXT NOT NULL,
  type TEXT NOT NULL,
  purchase_id TEXT,
  actor TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_purchase_id
  ON audit_events(purchase_id, seq);
`;

export function createDatabase(databasePath: string): AppDatabase {
  if (databasePath !== ":memory:") {
    mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  }

  const raw = new Database(databasePath);
  if (databasePath !== ":memory:") {
    raw.pragma("journal_mode = WAL");
  }
  raw.pragma("foreign_keys = ON");

  const migrate = () => {
    raw.exec(MIGRATIONS_SQL);
  };

  migrate();

  return {
    raw,
    migrate,
    transaction<T>(fn: () => T): T {
      const tx = raw.transaction(fn);
      return tx();
    },
    resetForDemo(): void {
      const clear = raw.transaction(() => {
        raw.exec(`
          DELETE FROM approvals;
          DELETE FROM purchases;
          DELETE FROM mandates;
          DELETE FROM audit_events;
        `);
      });
      clear();
    },
    close(): void {
      raw.close();
    },
  };
}

