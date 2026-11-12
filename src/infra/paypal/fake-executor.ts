import type {
  CapturePaymentOrderInput,
  CapturePaymentOrderResult,
  CreatePaymentOrderInput,
  CreatePaymentOrderResult,
  PaymentExecutor,
} from "@/services/payment-executor";

export interface FakePaymentExecutorOptions {
  mode?: "auto-capture" | "redirect";
  failOnCreateMessage?: string;
  failOnCaptureMessage?: string;
}

export class FakePaymentExecutor implements PaymentExecutor {
  readonly isSimulated = true;
  readonly createCalls: CreatePaymentOrderInput[] = [];
  readonly captureCalls: CapturePaymentOrderInput[] = [];
  private seq = 0;

  constructor(private readonly options: FakePaymentExecutorOptions = {}) {}

  async createOrder(
    input: CreatePaymentOrderInput
  ): Promise<CreatePaymentOrderResult> {
    this.createCalls.push(input);
    if (this.options.failOnCreateMessage) {
      throw new Error(this.options.failOnCreateMessage);
    }

    this.seq += 1;
    const orderId = `SIM-ORD-${this.seq}`;
    if (this.options.mode === "redirect") {
      return {
        orderId,
        status: "PAYER_ACTION_REQUIRED",
        approvalUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}`,
      };
    }

    return {
      orderId,
      status: "COMPLETED",
      approvalUrl: null,
      captureId: `SIM-CAP-${this.seq}`,
    };
  }

  async captureOrder(
    input: CapturePaymentOrderInput
  ): Promise<CapturePaymentOrderResult> {
    this.captureCalls.push(input);
    if (this.options.failOnCaptureMessage) {
      throw new Error(this.options.failOnCaptureMessage);
    }
    return {
      orderId: input.orderId,
      captureId: `SIM-CAP-${input.orderId}`,
      status: "COMPLETED",
    };
  }
}

