import type {
  CapturePaymentOrderInput,
  CapturePaymentOrderResult,
  CreatePaymentOrderInput,
  CreatePaymentOrderResult,
  PaymentExecutor,
} from "@/services/payment-executor";
import { PayPalClient } from "./client";

/**
 * Mode B PayPal payment executor.
 * This is the ONLY module in the application permitted to import PayPalClient.
 */
export class PayPalPaymentExecutor implements PaymentExecutor {
  private readonly client: PayPalClient;

  constructor(config: {
    env: string;
    clientId: string;
    clientSecret: string;
    fetchFn?: typeof fetch;
  }) {
    this.client = new PayPalClient(config);
  }

  async createOrder(
    input: CreatePaymentOrderInput
  ): Promise<CreatePaymentOrderResult> {
    const created = await this.client.createOrder({
      purchaseId: input.purchaseId,
      title: input.title,
      amountCents: input.amountCents,
      returnUrl: input.returnUrl,
      cancelUrl: input.cancelUrl,
    });

    if (created.status === "COMPLETED") {
      return {
        orderId: created.orderId,
        status: "COMPLETED",
        approvalUrl: null,
      };
    }

    return {
      orderId: created.orderId,
      status: "PAYER_ACTION_REQUIRED",
      approvalUrl: created.approvalUrl,
    };
  }

  async captureOrder(
    input: CapturePaymentOrderInput
  ): Promise<CapturePaymentOrderResult> {
    const captured = await this.client.captureOrder({
      purchaseId: input.purchaseId,
      orderId: input.orderId,
    });

    return {
      orderId: captured.orderId,
      captureId: captured.captureId,
      status: "COMPLETED",
    };
  }
}
