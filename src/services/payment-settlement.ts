import { formatCentsToUsd } from "@/domain/money";
import type { AppDatabase } from "@/infra/db/client";
import type { PurchaseRecord, Repositories } from "@/infra/db/repositories";
import type { AuditService } from "./audit";
import type { PaymentExecutor } from "./payment-executor";

export interface ExecutionDeps {
  db: AppDatabase;
  repos: Repositories;
  audit: AuditService;
  executor: PaymentExecutor;
  appBaseUrl: string;
  nowFn: () => Date;
}

function getSafeErrorInfo(err: unknown): { code: string; message: string } {
  if (err && typeof err === "object" && "code" in err && "message" in err) {
    return {
      code: String((err as { code: unknown }).code),
      message: String((err as { message: unknown }).message),
    };
  }
  if (err instanceof Error) {
    return { code: "PAYMENT_ERROR", message: err.message };
  }
  return { code: "PAYMENT_ERROR", message: "Unknown payment execution error" };
}

/**
 * Executes PayPal order creation outside SQLite locks and atomically persists
 * the resulting purchase state + audit event(s).
 */
export async function executeAndRecordOrder(
  deps: ExecutionDeps,
  purchase: PurchaseRecord
): Promise<PurchaseRecord> {
  const baseUrl = deps.appBaseUrl.replace(/\/+$/, "");
  const returnUrl = `${baseUrl}/api/paypal/connect/return`;
  const cancelUrl = `${baseUrl}/api/paypal/connect/cancel`;

  try {
    const order = await deps.executor.createOrder({
      purchaseId: purchase.id,
      title: purchase.title,
      amountCents: purchase.totalCents,
      returnUrl,
      cancelUrl,
    });

    const nowIso = deps.nowFn().toISOString();
    const isSimulated = Boolean(deps.executor.isSimulated);
    const simPrefix = isSimulated ? "[SIMULATED] " : "";

    return deps.db.transaction(() => {
      if (order.status === "COMPLETED") {
        deps.repos.purchases.updateState(purchase.id, {
          status: "captured",
          paypalOrderId: order.orderId,
          paypalApprovalUrl: null,
          updatedAt: nowIso,
          capturedAt: nowIso,
        });
        deps.audit.record({
          type: "PAYPAL_ORDER_CREATED",
          actor: "paypal",
          purchaseId: purchase.id,
          summary: `${simPrefix}Created PayPal order ${order.orderId} for ${formatCentsToUsd(purchase.totalCents)}`,
          payload: {
            orderId: order.orderId,
            status: order.status,
            simulated: isSimulated,
          },
        });
        deps.audit.record({
          type: "PAYPAL_CAPTURED",
          actor: "paypal",
          purchaseId: purchase.id,
          summary: `${simPrefix}Captured ${formatCentsToUsd(purchase.totalCents)} (Order ${order.orderId})`,
          payload: {
            orderId: order.orderId,
            captureId: order.captureId ?? null,
            amountCents: purchase.totalCents,
            simulated: isSimulated,
          },
        });
      } else {
        deps.repos.purchases.updateState(purchase.id, {
          status: "approved",
          paypalOrderId: order.orderId,
          paypalApprovalUrl: order.approvalUrl,
          updatedAt: nowIso,
        });
        deps.audit.record({
          type: "PAYPAL_ORDER_CREATED",
          actor: "paypal",
          purchaseId: purchase.id,
          summary: `${simPrefix}Created PayPal order ${order.orderId} awaiting buyer approval`,
          payload: {
            orderId: order.orderId,
            status: order.status,
            simulated: isSimulated,
          },
        });
      }

      return deps.repos.purchases.findById(purchase.id) ?? purchase;
    });
  } catch (err) {
    const nowIso = deps.nowFn().toISOString();
    const errorInfo = getSafeErrorInfo(err);
    const isSimulated = Boolean(deps.executor.isSimulated);
    const simPrefix = isSimulated ? "[SIMULATED] " : "";
    return deps.db.transaction(() => {
      deps.repos.purchases.updateState(purchase.id, {
        status: "failed",
        updatedAt: nowIso,
      });
      deps.audit.record({
        type: "PAYPAL_FAILED",
        actor: "paypal",
        purchaseId: purchase.id,
        summary: `${simPrefix}PayPal order failed: ${errorInfo.message}`,
        payload: { code: errorInfo.code, simulated: isSimulated },
      });
      return deps.repos.purchases.findById(purchase.id) ?? purchase;
    });
  }
}

