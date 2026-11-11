import { getUtcMonthWindow } from "@/domain/month-window";
import {
  ApprovalStatusSchema,
  AuditActorSchema,
  AuditEventTypeSchema,
  MandateSchema,
  PolicyDecisionSchema,
  PurchaseStatusSchema,
  type ApprovalStatus,
  type AuditActor,
  type AuditEventType,
  type Mandate,
  type PolicyDecision,
  type PurchaseStatus,
} from "@/domain/schemas";
import type { AppDatabase } from "./client";

export interface PurchaseRecord {
  id: string;
  mandateId: string | null;
  productId: string;
  title: string;
  merchant: string;
  category: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  status: PurchaseStatus;
  policyDecision: PolicyDecision;
  paypalOrderId: string | null;
  paypalApprovalUrl: string | null;
  createdAt: string;
  updatedAt: string;
  capturedAt: string | null;
}

export interface ApprovalRecord {
  id: string;
  purchaseId: string;
  status: ApprovalStatus;
  createdAt: string;
  decidedAt: string | null;
}

export interface ApprovalWithPurchase {
  approval: ApprovalRecord;
  purchase: PurchaseRecord;
}

export interface AuditEventRecord {
  seq?: number;
  id: string;
  timestamp: string;
  type: AuditEventType;
  purchaseId: string | null;
  actor: AuditActor;
  summary: string;
  payload: Record<string, unknown>;
}

interface MandateRow {
  id: string;
  status: string;
  source_text: string;
  monthly_cap_cents: number;
  auto_approve_limit_cents: number;
  hard_limit_cents: number;
  allowed_categories_json: string;
  blocked_merchants_json: string;
  created_at: string;
  activated_at: string | null;
}

interface PurchaseRow {
  id: string;
  mandate_id: string | null;
  product_id: string;
  title: string;
  merchant: string;
  category: string;
  quantity: number;
  unit_price_cents: number;
  total_cents: number;
  status: string;
  policy_decision_json: string;
  paypal_order_id: string | null;
  paypal_approval_url: string | null;
  created_at: string;
  updated_at: string;
  captured_at: string | null;
}

interface ApprovalRow {
  id: string;
  purchase_id: string;
  status: string;
  created_at: string;
  decided_at: string | null;
}

interface AuditEventRow {
  seq: number;
  id: string;
  timestamp: string;
  type: string;
  purchase_id: string | null;
  actor: string;
  summary: string;
  payload_json: string;
}

function mapMandateRow(row: MandateRow): Mandate {
  return MandateSchema.parse({
    id: row.id,
    status: row.status,
    sourceText: row.source_text,
    monthlyCapCents: row.monthly_cap_cents,
    autoApproveLimitCents: row.auto_approve_limit_cents,
    hardLimitCents: row.hard_limit_cents,
    allowedCategories: JSON.parse(row.allowed_categories_json) as unknown,
    blockedMerchants: JSON.parse(row.blocked_merchants_json) as unknown,
    createdAt: row.created_at,
    activatedAt: row.activated_at,
  });
}

function mapPurchaseRow(row: PurchaseRow): PurchaseRecord {
  return {
    id: row.id,
    mandateId: row.mandate_id,
    productId: row.product_id,
    title: row.title,
    merchant: row.merchant,
    category: row.category,
    quantity: row.quantity,
    unitPriceCents: row.unit_price_cents,
    totalCents: row.total_cents,
    status: PurchaseStatusSchema.parse(row.status),
    policyDecision: PolicyDecisionSchema.parse(
      JSON.parse(row.policy_decision_json) as unknown
    ),
    paypalOrderId: row.paypal_order_id,
    paypalApprovalUrl: row.paypal_approval_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    capturedAt: row.captured_at,
  };
}

function mapApprovalRow(row: ApprovalRow): ApprovalRecord {
  return {
    id: row.id,
    purchaseId: row.purchase_id,
    status: ApprovalStatusSchema.parse(row.status),
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

function mapAuditRow(row: AuditEventRow): AuditEventRecord {
  return {
    seq: row.seq,
    id: row.id,
    timestamp: row.timestamp,
    type: AuditEventTypeSchema.parse(row.type),
    purchaseId: row.purchase_id,
    actor: AuditActorSchema.parse(row.actor),
    summary: row.summary,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
  };
}

export function createRepositories(db: AppDatabase) {
  const { raw } = db;

  const mandates = {
    insert(mandate: Mandate): Mandate {
      const validated = MandateSchema.parse(mandate);
      raw
        .prepare(
          `INSERT INTO mandates (
            id, status, source_text, monthly_cap_cents, auto_approve_limit_cents,
            hard_limit_cents, allowed_categories_json, blocked_merchants_json,
            created_at, activated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          validated.id,
          validated.status,
          validated.sourceText,
          validated.monthlyCapCents,
          validated.autoApproveLimitCents,
          validated.hardLimitCents,
          JSON.stringify(validated.allowedCategories),
          JSON.stringify(validated.blockedMerchants),
          validated.createdAt,
          validated.activatedAt
        );
      return validated;
    },

    findById(id: string): Mandate | null {
      const row = raw
        .prepare(`SELECT * FROM mandates WHERE id = ?`)
        .get(id) as MandateRow | undefined;
      return row ? mapMandateRow(row) : null;
    },

    findActive(): Mandate | null {
      const row = raw
        .prepare(
          `SELECT * FROM mandates WHERE status = 'active' ORDER BY activated_at DESC LIMIT 1`
        )
        .get() as MandateRow | undefined;
      return row ? mapMandateRow(row) : null;
    },

    activate(id: string, activatedAt: string): Mandate | null {
      const activateTx = raw.transaction(() => {
        raw
          .prepare(`UPDATE mandates SET status = 'archived' WHERE status = 'active' AND id != ?`)
          .run(id);
        const result = raw
          .prepare(
            `UPDATE mandates SET status = 'active', activated_at = ? WHERE id = ?`
          )
          .run(activatedAt, id);
        if (result.changes === 0) {
          return null;
        }
        return mandates.findById(id);
      });
      return activateTx();
    },
  };

  const purchases = {
    insert(purchase: PurchaseRecord): PurchaseRecord {
      raw
        .prepare(
          `INSERT INTO purchases (
            id, mandate_id, product_id, title, merchant, category,
            quantity, unit_price_cents, total_cents, status, policy_decision_json,
            paypal_order_id, paypal_approval_url, created_at, updated_at, captured_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          purchase.id,
          purchase.mandateId,
          purchase.productId,
          purchase.title,
          purchase.merchant,
          purchase.category,
          purchase.quantity,
          purchase.unitPriceCents,
          purchase.totalCents,
          purchase.status,
          JSON.stringify(purchase.policyDecision),
          purchase.paypalOrderId,
          purchase.paypalApprovalUrl,
          purchase.createdAt,
          purchase.updatedAt,
          purchase.capturedAt
        );
      return purchase;
    },

    findById(id: string): PurchaseRecord | null {
      const row = raw
        .prepare(`SELECT * FROM purchases WHERE id = ?`)
        .get(id) as PurchaseRow | undefined;
      return row ? mapPurchaseRow(row) : null;
    },

    findByPaypalOrderId(paypalOrderId: string): PurchaseRecord | null {
      const row = raw
        .prepare(`SELECT * FROM purchases WHERE paypal_order_id = ?`)
        .get(paypalOrderId) as PurchaseRow | undefined;
      return row ? mapPurchaseRow(row) : null;
    },

    updateState(
      id: string,
      patch: {
        status: PurchaseStatus;
        policyDecision?: PolicyDecision;
        paypalOrderId?: string | null;
        paypalApprovalUrl?: string | null;
        updatedAt: string;
        capturedAt?: string | null;
      }
    ): void {
      const existing = purchases.findById(id);
      if (!existing) {
        return;
      }
      raw
        .prepare(
          `UPDATE purchases
           SET status = ?,
               policy_decision_json = ?,
               paypal_order_id = ?,
               paypal_approval_url = ?,
               updated_at = ?,
               captured_at = ?
           WHERE id = ?`
        )
        .run(
          patch.status,
          JSON.stringify(patch.policyDecision ?? existing.policyDecision),
          patch.paypalOrderId !== undefined
            ? patch.paypalOrderId
            : existing.paypalOrderId,
          patch.paypalApprovalUrl !== undefined
            ? patch.paypalApprovalUrl
            : existing.paypalApprovalUrl,
          patch.updatedAt,
          patch.capturedAt !== undefined
            ? patch.capturedAt
            : existing.capturedAt,
          id
        );
    },

    sumCapturedInUtcMonth(now: Date): number {
      const window = getUtcMonthWindow(now);
      const row = raw
        .prepare(
          `SELECT COALESCE(SUM(total_cents), 0) AS total
           FROM purchases
           WHERE status = 'captured'
             AND captured_at >= ?
             AND captured_at < ?`
        )
        .get(window.startIso, window.endExclusiveIso) as { total: number };
      return row.total;
    },

    listAll(): PurchaseRecord[] {
      const rows = raw
        .prepare(`SELECT * FROM purchases ORDER BY created_at DESC`)
        .all() as PurchaseRow[];
      return rows.map(mapPurchaseRow);
    },
  };

  const approvals = {
    insert(approval: ApprovalRecord): ApprovalRecord {
      raw
        .prepare(
          `INSERT INTO approvals (id, purchase_id, status, created_at, decided_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          approval.id,
          approval.purchaseId,
          approval.status,
          approval.createdAt,
          approval.decidedAt
        );
      return approval;
    },

    findById(id: string): ApprovalRecord | null {
      const row = raw
        .prepare(`SELECT * FROM approvals WHERE id = ?`)
        .get(id) as ApprovalRow | undefined;
      return row ? mapApprovalRow(row) : null;
    },

    findByPurchaseId(purchaseId: string): ApprovalRecord | null {
      const row = raw
        .prepare(`SELECT * FROM approvals WHERE purchase_id = ?`)
        .get(purchaseId) as ApprovalRow | undefined;
      return row ? mapApprovalRow(row) : null;
    },

    updateStatus(
      id: string,
      status: ApprovalStatus,
      decidedAt: string
    ): void {
      raw
        .prepare(`UPDATE approvals SET status = ?, decided_at = ? WHERE id = ?`)
        .run(status, decidedAt, id);
    },

    listWithPurchases(): ApprovalWithPurchase[] {
      const rows = raw
        .prepare(
          `SELECT a.id AS a_id, a.purchase_id AS a_purchase_id, a.status AS a_status,
                  a.created_at AS a_created_at, a.decided_at AS a_decided_at,
                  p.*
           FROM approvals a
           JOIN purchases p ON p.id = a.purchase_id
           ORDER BY CASE WHEN a.status = 'pending' THEN 0 ELSE 1 END, a.created_at DESC`
        )
        .all() as Array<
        PurchaseRow & {
          a_id: string;
          a_purchase_id: string;
          a_status: string;
          a_created_at: string;
          a_decided_at: string | null;
        }
      >;

      return rows.map((row) => ({
        approval: {
          id: row.a_id,
          purchaseId: row.a_purchase_id,
          status: ApprovalStatusSchema.parse(row.a_status),
          createdAt: row.a_created_at,
          decidedAt: row.a_decided_at,
        },
        purchase: mapPurchaseRow(row),
      }));
    },
  };

  // Append-only repository: strictly insert and read operations only.
  const audit = {
    insert(event: AuditEventRecord): AuditEventRecord {
      raw
        .prepare(
          `INSERT INTO audit_events (id, timestamp, type, purchase_id, actor, summary, payload_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          event.id,
          event.timestamp,
          event.type,
          event.purchaseId,
          event.actor,
          event.summary,
          JSON.stringify(event.payload)
        );
      return event;
    },

    list(limit = 500): AuditEventRecord[] {
      const rows = raw
        .prepare(`SELECT * FROM audit_events ORDER BY seq ASC LIMIT ?`)
        .all(limit) as AuditEventRow[];
      return rows.map(mapAuditRow);
    },

    listByPurchaseId(purchaseId: string): AuditEventRecord[] {
      const rows = raw
        .prepare(
          `SELECT * FROM audit_events WHERE purchase_id = ? ORDER BY seq ASC`
        )
        .all(purchaseId) as AuditEventRow[];
      return rows.map(mapAuditRow);
    },
  };

  return { mandates, purchases, approvals, audit };
}

export type Repositories = ReturnType<typeof createRepositories>;

