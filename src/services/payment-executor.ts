export interface CreatePaymentOrderInput {
  purchaseId: string;
  title: string;
  amountCents: number;
  returnUrl: string;
  cancelUrl: string;
}

export interface CreatePaymentOrderResult {
  orderId: string;
  status: "CREATED" | "PAYER_ACTION_REQUIRED" | "COMPLETED";
  /** Populated in Mode B when buyer browser approval is required before capture. */
  approvalUrl: string | null;
  captureId?: string;
}

export interface CapturePaymentOrderInput {
  purchaseId: string;
  orderId: string;
}

export interface CapturePaymentOrderResult {
  orderId: string;
  captureId: string;
  status: "COMPLETED";
}

export interface PaymentExecutor {
  readonly isSimulated?: boolean;
  createOrder(input: CreatePaymentOrderInput): Promise<CreatePaymentOrderResult>;
  captureOrder(
    input: CapturePaymentOrderInput
  ): Promise<CapturePaymentOrderResult>;
}

