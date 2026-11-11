import { randomUUID } from "node:crypto";
import { DomainError } from "@/domain/errors";
import { formatCentsToUsd, multiplyCents } from "@/domain/money";
import { evaluatePolicy } from "@/domain/policy";
import type { PolicyDecision } from "@/domain/schemas";
import type { AppDatabase } from "@/infra/db/client";
import type { PurchaseRecord, Repositories } from "@/infra/db/repositories";
import type { ProductProvider } from "@/infra/products";
import type { AuditService } from "./audit";
import type { PaymentExecutor } from "./payment-executor";
import { executeAndRecordOrder } from "./payment-settlement";

export interface OrchestratorConfig {
  appBaseUrl: string;
  nowFn?: () => Date;
}

export interface RequestPurchaseInput {
  productId: string;
  quantity: number;
}

export interface RequestPurchaseResult {
  purchase: PurchaseRecord;
  decision: PolicyDecision;
  approvalId: string | null;
}

export class PurchaseOrchestrator {
  private readonly nowFn: () => Date;

  constructor(
    private readonly db: AppDatabase,
    private readonly repos: Repositories,
    private readonly audit: AuditService,
    private readonly products: ProductProvider,
    private readonly executor: PaymentExecutor,
    private readonly config: OrchestratorConfig
  ) {
    this.nowFn = config.nowFn ?? (() => new Date());
  }

  async requestPurchase(
    input: RequestPurchaseInput
  ): Promise<RequestPurchaseResult> {
    const product = await this.products.getById(input.productId);
    if (!product) {
      throw new DomainError(
        "PRODUCT_NOT_FOUND",
        `Product "${input.productId}" was not found in the catalog.`
      );
    }

    const { purchase, decision, approvalId } = this.db.transaction(() => {
      const now = this.nowFn();
      const nowIso = now.toISOString();
      const mandate = this.repos.mandates.findActive();
      const spentThisMonthCents = this.repos.purchases.sumCapturedInUtcMonth(now);

      const evaluated = evaluatePolicy(
        {
          productId: product.id,
          merchant: product.merchant,
          category: product.category,
          unitPriceCents: product.priceCents,
          quantity: input.quantity,
        },
        {
          mandate,
          spentThisMonthCents,
          now,
        }
      );

      const validTotal =
        Number.isSafeInteger(input.quantity) && input.quantity >= 1
          ? multiplyCents(product.priceCents, input.quantity)
          : product.priceCents;

      const initialStatus =
        evaluated.decision === "APPROVE"
          ? "approved"
          : evaluated.decision === "ASK_HUMAN"
            ? "pending_approval"
            : "denied";

      const purchaseId = `pur_${randomUUID()}`;
      const insertedPurchase = this.repos.purchases.insert({
        id: purchaseId,
        mandateId: mandate?.id ?? null,
        productId: product.id,
        title: product.title,
        merchant: product.merchant,
        category: product.category,
        quantity: input.quantity,
        unitPriceCents: product.priceCents,
        totalCents: validTotal,
        status: initialStatus,
        policyDecision: evaluated,
        paypalOrderId: null,
        paypalApprovalUrl: null,
        createdAt: nowIso,
        updatedAt: nowIso,
        capturedAt: null,
      });

      this.audit.record({
        type: "POLICY_DECISION",
        actor: "policy",
        purchaseId,
        summary: `${evaluated.decision} (${evaluated.reasonCode}) for ${product.title} (${formatCentsToUsd(validTotal)})`,
        payload: {
          decision: evaluated.decision,
          reasonCode: evaluated.reasonCode,
          explanation: evaluated.explanation,
          totalCents: validTotal,
          remainingBudgetCents: evaluated.remainingBudgetCents,
        },
      });

      let createdApprovalId: string | null = null;
      if (evaluated.decision === "ASK_HUMAN") {
        createdApprovalId = `apr_${randomUUID()}`;
        this.repos.approvals.insert({
          id: createdApprovalId,
          purchaseId,
          status: "pending",
          createdAt: nowIso,
          decidedAt: null,
        });
        this.audit.record({
          type: "APPROVAL_REQUESTED",
          actor: "system",
          purchaseId,
          summary: `Queued approval ${createdApprovalId} for ${product.title} (${formatCentsToUsd(validTotal)})`,
          payload: {
            approvalId: createdApprovalId,
            reasonCode: evaluated.reasonCode,
          },
        });
      }

      return {
        purchase: insertedPurchase,
        decision: evaluated,
        approvalId: createdApprovalId,
      };
    });

    if (decision.decision !== "APPROVE") {
      return { purchase, decision, approvalId };
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
      purchase
    );

    return {
      purchase: updatedPurchase,
      decision,
      approvalId: null,
    };
  }
}

