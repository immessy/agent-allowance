import { DomainError } from "@/domain/errors";
import { formatCentsToUsd } from "@/domain/money";
import { evaluatePolicy } from "@/domain/policy";
import type { PolicyDecision } from "@/domain/schemas";
import type { AppDatabase } from "@/infra/db/client";
import type {
  ApprovalRecord,
  ApprovalWithPurchase,
  PurchaseRecord,
  Repositories,
} from "@/infra/db/repositories";
import type { AuditService } from "./audit";
import type { PaymentExecutor } from "./payment-executor";
import { executeAndRecordOrder } from "./payment-settlement";

export interface ApprovalServiceConfig {
  appBaseUrl: string;
  nowFn?: () => Date;
}

export type ApproveResult =
  | {
      ok: true;
      approval: ApprovalRecord;
      purchase: PurchaseRecord;
    }
  | {
      ok: false;
      approval: ApprovalRecord;
      purchase: PurchaseRecord;
      decision: PolicyDecision;
    };

export class ApprovalService {
  private readonly nowFn: () => Date;

  constructor(
    private readonly db: AppDatabase,
    private readonly repos: Repositories,
    private readonly audit: AuditService,
    private readonly executor: PaymentExecutor,
    private readonly config: ApprovalServiceConfig
  ) {
    this.nowFn = config.nowFn ?? (() => new Date());
  }

  listApprovals(): ApprovalWithPurchase[] {
    return this.repos.approvals.listWithPurchases();
  }

  async approve(approvalId: string): Promise<ApproveResult> {
    const prep = this.db.transaction(() => {
      const approval = this.repos.approvals.findById(approvalId);
      if (!approval) {
        throw new DomainError(
          "APPROVAL_NOT_FOUND",
          `Approval "${approvalId}" was not found.`
        );
      }
      const purchase = this.repos.purchases.findById(approval.purchaseId);
      if (!purchase) {
        throw new DomainError(
          "PURCHASE_NOT_FOUND",
          `Purchase "${approval.purchaseId}" was not found.`
        );
      }

      if (
        approval.status === "rejected" ||
        purchase.status === "rejected" ||
        purchase.status === "denied"
      ) {
        throw new DomainError(
          "APPROVAL_ALREADY_REJECTED",
          "This approval request was already rejected or denied."
        );
      }

      if (approval.status === "approved") {
        // Idempotent: already approved/executed (captured or awaiting Mode B redirect)
        return {
          mode: "idempotent" as const,
          approval,
          purchase,
        };
      }

      // Re-evaluate policy at approval time to prevent stale approvals
      const now = this.nowFn();
      const nowIso = now.toISOString();
      const mandate = this.repos.mandates.findActive();
      const spentThisMonthCents = this.repos.purchases.sumCapturedInUtcMonth(now);

      const reevaluated = evaluatePolicy(
        {
          productId: purchase.productId,
          merchant: purchase.merchant,
          category: purchase.category,
          unitPriceCents: purchase.unitPriceCents,
          quantity: purchase.quantity,
        },
        {
          mandate,
          spentThisMonthCents,
          now,
        }
      );

      if (reevaluated.decision === "DENY") {
        this.repos.approvals.updateStatus(approval.id, "rejected", nowIso);
        this.repos.purchases.updateState(purchase.id, {
          status: "denied",
          policyDecision: reevaluated,
          updatedAt: nowIso,
        });
        this.audit.record({
          type: "POLICY_DECISION",
          actor: "policy",
          purchaseId: purchase.id,
          summary: `Approval blocked on re-evaluation: ${reevaluated.explanation}`,
          payload: {
            approvalId: approval.id,
            decision: reevaluated.decision,
            reasonCode: reevaluated.reasonCode,
          },
        });
        return {
          mode: "denied" as const,
          approval: this.repos.approvals.findById(approval.id) ?? approval,
          purchase: this.repos.purchases.findById(purchase.id) ?? purchase,
          decision: reevaluated,
        };
      }

      this.repos.approvals.updateStatus(approval.id, "approved", nowIso);
      this.repos.purchases.updateState(purchase.id, {
        status: "approved",
        policyDecision: reevaluated,
        updatedAt: nowIso,
      });
      this.audit.record({
        type: "APPROVAL_GRANTED",
        actor: "user",
        purchaseId: purchase.id,
        summary: `Human approved ${purchase.title} (${formatCentsToUsd(purchase.totalCents)})`,
        payload: { approvalId: approval.id },
      });

      return {
        mode: "execute" as const,
        approval: this.repos.approvals.findById(approval.id) ?? approval,
        purchase: this.repos.purchases.findById(purchase.id) ?? purchase,
      };
    });

    if (prep.mode === "idempotent") {
      return { ok: true, approval: prep.approval, purchase: prep.purchase };
    }
    if (prep.mode === "denied") {
      return {
        ok: false,
        approval: prep.approval,
        purchase: prep.purchase,
        decision: prep.decision,
      };
    }

    const updatedPurchase = await executeAndRecordOrder(
      {
        db: this.db,
        repos: this.repos,
        audit: this.audit,
        executor: this.executor,
        appBaseUrl: this.config.appBaseUrl,
        nowFn: this.nowFn,
      },
      prep.purchase
    );

    return {
      ok: true,
      approval: prep.approval,
      purchase: updatedPurchase,
    };
  }

  async reject(
    approvalId: string
  ): Promise<{ approval: ApprovalRecord; purchase: PurchaseRecord }> {
    return this.db.transaction(() => {
      const approval = this.repos.approvals.findById(approvalId);
      if (!approval) {
        throw new DomainError(
          "APPROVAL_NOT_FOUND",
          `Approval "${approvalId}" was not found.`
        );
      }
      const purchase = this.repos.purchases.findById(approval.purchaseId);
      if (!purchase) {
        throw new DomainError(
          "PURCHASE_NOT_FOUND",
          `Purchase "${approval.purchaseId}" was not found.`
        );
      }

      if (approval.status === "approved" || purchase.status === "captured") {
        throw new DomainError(
          "APPROVAL_ALREADY_GRANTED",
          "Cannot reject an approval that has already been granted."
        );
      }
      if (approval.status === "rejected") {
        return { approval, purchase };
      }

      const nowIso = this.nowFn().toISOString();
      this.repos.approvals.updateStatus(approval.id, "rejected", nowIso);
      this.repos.purchases.updateState(purchase.id, {
        status: "rejected",
        updatedAt: nowIso,
      });
      this.audit.record({
        type: "APPROVAL_REJECTED",
        actor: "user",
        purchaseId: purchase.id,
        summary: `Human rejected ${purchase.title} (${formatCentsToUsd(purchase.totalCents)})`,
        payload: { approvalId: approval.id },
      });

      return {
        approval: this.repos.approvals.findById(approval.id) ?? approval,
        purchase: this.repos.purchases.findById(purchase.id) ?? purchase,
      };
    });
  }

  async completeOrderCapture(paypalOrderId: string): Promise<PurchaseRecord> {
    const existing = this.repos.purchases.findByPaypalOrderId(paypalOrderId);
    if (!existing) {
      throw new DomainError(
        "ORDER_NOT_FOUND",
        `No purchase found for PayPal order "${paypalOrderId}".`
      );
    }

    if (existing.status === "captured") {
      return existing;
    }

    if (existing.status !== "approved") {
      throw new DomainError(
        "PURCHASE_NOT_PAYABLE",
        `Purchase "${existing.id}" is in status "${existing.status}" and cannot be captured.`
      );
    }

    try {
      const capture = await this.executor.captureOrder({
        purchaseId: existing.id,
        orderId: paypalOrderId,
      });

      const nowIso = this.nowFn().toISOString();
      const isSimulated = Boolean(this.executor.isSimulated);
      const simPrefix = isSimulated ? "[SIMULATED] " : "";
      return this.db.transaction(() => {
        const latest = this.repos.purchases.findById(existing.id);
        if (latest?.status === "captured") {
          return latest;
        }
        this.repos.purchases.updateState(existing.id, {
          status: "captured",
          paypalApprovalUrl: null,
          updatedAt: nowIso,
          capturedAt: nowIso,
        });
        this.audit.record({
          type: "PAYPAL_CAPTURED",
          actor: "paypal",
          purchaseId: existing.id,
          summary: `${simPrefix}Captured ${formatCentsToUsd(existing.totalCents)} (Order ${capture.orderId})`,
          payload: {
            orderId: capture.orderId,
            captureId: capture.captureId,
            amountCents: existing.totalCents,
            simulated: isSimulated,
          },
        });
        return this.repos.purchases.findById(existing.id) ?? existing;
      });
    } catch (err) {
      const nowIso = this.nowFn().toISOString();
      const isSimulated = Boolean(this.executor.isSimulated);
      const simPrefix = isSimulated ? "[SIMULATED] " : "";
      const message =
        err instanceof Error ? err.message : "PayPal capture failed";
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: unknown }).code)
          : "PAYPAL_CAPTURE_ERROR";

      this.db.transaction(() => {
        this.repos.purchases.updateState(existing.id, {
          status: "failed",
          paypalApprovalUrl: null,
          updatedAt: nowIso,
        });
        this.audit.record({
          type: "PAYPAL_FAILED",
          actor: "paypal",
          purchaseId: existing.id,
          summary: `${simPrefix}PayPal capture failed for order ${paypalOrderId}: ${message}`,
          payload: { orderId: paypalOrderId, code, simulated: isSimulated },
        });
      });

      throw err;
    }
  }

  cancelOrderRedirect(paypalOrderId: string): PurchaseRecord | null {
    const existing = this.repos.purchases.findByPaypalOrderId(paypalOrderId);
    if (!existing) {
      return null;
    }
    if (existing.status === "captured") {
      return existing;
    }

    const nowIso = this.nowFn().toISOString();
    return this.db.transaction(() => {
      this.repos.purchases.updateState(existing.id, {
        status: "failed",
        paypalApprovalUrl: null,
        updatedAt: nowIso,
      });
      this.audit.record({
        type: "PAYPAL_FAILED",
        actor: "user",
        purchaseId: existing.id,
        summary: `Buyer cancelled PayPal checkout for order ${paypalOrderId}`,
        payload: { orderId: paypalOrderId, reason: "BUYER_CANCELLED" },
      });
      return this.repos.purchases.findById(existing.id) ?? existing;
    });
  }
}

