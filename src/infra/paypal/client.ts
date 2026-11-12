import { z } from "zod";
import { formatCentsToDecimal } from "@/domain/money";

const SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";
const TOKEN_REFRESH_BUFFER_MS = 30_000;
const MAX_TRANSIENT_RETRIES = 2;

export type PayPalErrorKind = "auth" | "validation" | "declined" | "transient";

export class PayPalError extends Error {
  readonly code: string;
  readonly kind: PayPalErrorKind;
  readonly statusCode: number | null;

  constructor(
    kind: PayPalErrorKind,
    message: string,
    statusCode: number | null = null
  ) {
    super(message);
    this.name = "PayPalError";
    this.kind = kind;
    this.code = `PAYPAL_${kind.toUpperCase()}`;
    this.statusCode = statusCode;
  }
}

export interface PayPalClientConfig {
  env: string;
  clientId: string;
  clientSecret: string;
  fetchFn?: typeof fetch;
  nowFn?: () => number;
  retryDelayMs?: number;
}

const OAuthTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

const PayPalLinkSchema = z.object({
  rel: z.string(),
  href: z.string(),
  method: z.string().optional(),
});

const CreateOrderResponseSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  links: z.array(PayPalLinkSchema).default([]),
});

const CaptureOrderResponseSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  purchase_units: z
    .array(
      z.object({
        payments: z
          .object({
            captures: z
              .array(
                z.object({
                  id: z.string().min(1),
                  status: z.string().min(1),
                })
              )
              .default([]),
          })
          .optional(),
      })
    )
    .default([]),
});

const PayPalErrorBodySchema = z
  .object({
    name: z.string().optional(),
    message: z.string().optional(),
    error: z.string().optional(),
    error_description: z.string().optional(),
    details: z
      .array(
        z.object({
          issue: z.string().optional(),
          description: z.string().optional(),
        })
      )
      .optional(),
  })
  .passthrough();

export interface CreateOrderParams {
  purchaseId: string;
  title: string;
  amountCents: number;
  returnUrl: string;
  cancelUrl: string;
}

export interface PayPalOrderCreated {
  orderId: string;
  status: string;
  approvalUrl: string | null;
}

export interface CaptureOrderParams {
  purchaseId: string;
  orderId: string;
}

export interface PayPalOrderCaptured {
  orderId: string;
  captureId: string;
  status: string;
}

const DECLINED_ISSUES = new Set([
  "INSTRUMENT_DECLINED",
  "PAYER_CANNOT_PAY",
  "PAYMENT_DENIED",
  "TRANSACTION_REFUSED",
]);

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PayPalClient {
  private readonly fetchFn: typeof fetch;
  private readonly nowFn: () => number;
  private readonly retryDelayMs: number;
  private cachedToken: { token: string; refreshAtMs: number } | null = null;

  constructor(private readonly config: PayPalClientConfig) {
    if (config.env !== "sandbox") {
      throw new PayPalError(
        "auth",
        `Refusing to start PayPalClient outside sandbox (received "${config.env}").`
      );
    }
    if (!config.clientId.trim() || !config.clientSecret.trim()) {
      throw new PayPalError("auth", "Missing PayPal sandbox credentials.");
    }
    this.fetchFn = config.fetchFn ?? fetch;
    this.nowFn = config.nowFn ?? Date.now;
    this.retryDelayMs = config.retryDelayMs ?? 250;
  }

  private async getAccessToken(): Promise<string> {
    const now = this.nowFn();
    if (this.cachedToken && now < this.cachedToken.refreshAtMs) {
      return this.cachedToken.token;
    }

    const basic = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`
    ).toString("base64");

    const response = await this.fetchFn(`${SANDBOX_BASE_URL}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    if (!response.ok) {
      throw await this.mapHttpError(response);
    }

    const parsed = OAuthTokenResponseSchema.parse(await response.json());
    const ttlMs = parsed.expires_in * 1000;
    const bufferMs = Math.min(TOKEN_REFRESH_BUFFER_MS, Math.floor(ttlMs / 2));
    this.cachedToken = {
      token: parsed.access_token,
      refreshAtMs: now + ttlMs - bufferMs,
    };
    return parsed.access_token;
  }

  private async mapHttpError(response: Response): Promise<PayPalError> {
    let rawJson: unknown = null;
    try {
      rawJson = await response.json();
    } catch {
      rawJson = null;
    }

    const parsed = PayPalErrorBodySchema.safeParse(rawJson);
    const issue = parsed.success ? parsed.data.details?.[0]?.issue : undefined;
    const message =
      (parsed.success &&
        (parsed.data.details?.[0]?.description ||
          parsed.data.message ||
          parsed.data.error_description ||
          parsed.data.name)) ||
      `PayPal API error (${response.status})`;

    if (response.status === 401 || response.status === 403) {
      this.cachedToken = null;
      return new PayPalError("auth", message, response.status);
    }

    if (response.status === 429 || response.status >= 500) {
      return new PayPalError("transient", message, response.status);
    }

    if (issue && DECLINED_ISSUES.has(issue)) {
      return new PayPalError("declined", `${issue}: ${message}`, response.status);
    }

    return new PayPalError(
      "validation",
      issue ? `${issue}: ${message}` : message,
      response.status
    );
  }

  private async requestWithRetry(
    url: string,
    initBuilder: (token: string) => RequestInit
  ): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt += 1) {
      try {
        const token = await this.getAccessToken();
        const response = await this.fetchFn(url, initBuilder(token));
        if (response.ok) {
          return response;
        }
        const mapped = await this.mapHttpError(response);
        if (mapped.kind !== "transient" || attempt === MAX_TRANSIENT_RETRIES) {
          throw mapped;
        }
        lastError = mapped;
      } catch (err) {
        if (err instanceof PayPalError && err.kind !== "transient") {
          throw err;
        }
        const transientErr =
          err instanceof PayPalError
            ? err
            : new PayPalError(
                "transient",
                err instanceof Error ? err.message : "Network error calling PayPal"
              );
        if (attempt === MAX_TRANSIENT_RETRIES) {
          throw transientErr;
        }
        lastError = transientErr;
      }
      await sleep(this.retryDelayMs * 2 ** attempt);
    }
    throw lastError;
  }

  async createOrder(params: CreateOrderParams): Promise<PayPalOrderCreated> {
    const value = formatCentsToDecimal(params.amountCents);
    const idempotencyKey = `aa-${params.purchaseId}-create`;

    const response = await this.requestWithRetry(
      `${SANDBOX_BASE_URL}/v2/checkout/orders`,
      (token) => ({
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": idempotencyKey,
        },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [
            {
              reference_id: params.purchaseId,
              amount: {
                currency_code: "USD",
                value,
                breakdown: {
                  item_total: {
                    currency_code: "USD",
                    value,
                  },
                },
              },
              items: [
                {
                  name: params.title.slice(0, 127),
                  quantity: "1",
                  unit_amount: {
                    currency_code: "USD",
                    value,
                  },
                },
              ],
            },
          ],
          payment_source: {
            paypal: {
              experience_context: {
                brand_name: "Agent Allowance",
                shipping_preference: "NO_SHIPPING",
                user_action: "PAY_NOW",
                return_url: params.returnUrl,
                cancel_url: params.cancelUrl,
              },
            },
          },
        }),
      })
    );

    const parsed = CreateOrderResponseSchema.parse(await response.json());
    const approvalUrl =
      parsed.links.find(
        (link) => link.rel === "payer-action" || link.rel === "approve"
      )?.href ?? null;

    return {
      orderId: parsed.id,
      status: parsed.status,
      approvalUrl,
    };
  }

  async captureOrder(params: CaptureOrderParams): Promise<PayPalOrderCaptured> {
    const idempotencyKey = `aa-${params.purchaseId}-capture`;

    const response = await this.requestWithRetry(
      `${SANDBOX_BASE_URL}/v2/checkout/orders/${encodeURIComponent(params.orderId)}/capture`,
      (token) => ({
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": idempotencyKey,
          Prefer: "return=representation",
        },
        body: "{}",
      })
    );

    const parsed = CaptureOrderResponseSchema.parse(await response.json());
    const captureId =
      parsed.purchase_units[0]?.payments?.captures[0]?.id ?? parsed.id;

    return {
      orderId: parsed.id,
      captureId,
      status: parsed.status,
    };
  }
}

