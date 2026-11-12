import { z } from "zod";
import { multiplyCents } from "./money";

const NonEmptyTrimmedString = z.string().trim().min(1);

export const MandateStatusSchema = z.enum(["draft", "active", "archived"]);
export type MandateStatus = z.infer<typeof MandateStatusSchema>;

const mandateFields = {
  sourceText: NonEmptyTrimmedString,
  monthlyCapCents: z.number().int().positive(),
  autoApproveLimitCents: z.number().int().nonnegative(),
  hardLimitCents: z.number().int().nonnegative(),
  allowedCategories: z.array(NonEmptyTrimmedString).min(1),
  blockedMerchants: z.array(NonEmptyTrimmedString).default([]),
};

function validateMandateLimits(
  value: { autoApproveLimitCents: number; hardLimitCents: number },
  ctx: z.RefinementCtx
): void {
  if (value.hardLimitCents < value.autoApproveLimitCents) {
    ctx.addIssue({
      code: "custom",
      path: ["hardLimitCents"],
      message: "hardLimitCents cannot be lower than autoApproveLimitCents",
    });
  }
}

export const MandateDraftSchema = z
  .object(mandateFields)
  .superRefine(validateMandateLimits);
export type MandateDraft = z.infer<typeof MandateDraftSchema>;

export const MandateSchema = z
  .object({
    id: NonEmptyTrimmedString,
    status: MandateStatusSchema,
    ...mandateFields,
    createdAt: NonEmptyTrimmedString,
    activatedAt: NonEmptyTrimmedString.nullable(),
  })
  .superRefine(validateMandateLimits);
export type Mandate = z.infer<typeof MandateSchema>;

export const MandateParseOutputSchema = z.object({
  draft: MandateDraftSchema.nullable(),
  clarifyingQuestion: NonEmptyTrimmedString.nullable(),
});
export type MandateParseOutput = z.infer<typeof MandateParseOutputSchema>;

export function getMandateWarnings(
  mandate: Pick<
    MandateDraft,
    "monthlyCapCents" | "autoApproveLimitCents" | "hardLimitCents"
  >
): string[] {
  const warnings: string[] = [];
  if (mandate.hardLimitCents > mandate.monthlyCapCents) {
    warnings.push(
      "Per-item hard limit exceeds monthly cap, so purchases above the monthly cap will still be denied."
    );
  }
  if (mandate.autoApproveLimitCents > mandate.monthlyCapCents) {
    warnings.push(
      "Auto-approve limit exceeds monthly cap; remaining monthly budget always takes precedence."
    );
  }
  return warnings;
}

export const ProductSchema = z.object({
  id: NonEmptyTrimmedString,
  title: NonEmptyTrimmedString,
  description: z.string(),
  priceCents: z.number().int().positive(),
  category: NonEmptyTrimmedString,
  merchant: NonEmptyTrimmedString,
  imageEmoji: NonEmptyTrimmedString,
  flags: z.array(NonEmptyTrimmedString).default([]),
});
export type Product = z.infer<typeof ProductSchema>;

export const PurchaseRequestSchema = z
  .object({
    productId: NonEmptyTrimmedString,
    merchant: NonEmptyTrimmedString,
    category: NonEmptyTrimmedString,
    unitPriceCents: z.number().int().positive(),
    quantity: z.number().int().positive(),
    totalCents: z.number().int().positive().optional(),
  })
  .transform((value, ctx) => {
    const computed = multiplyCents(value.unitPriceCents, value.quantity);
    if (value.totalCents !== undefined && value.totalCents !== computed) {
      ctx.addIssue({
        code: "custom",
        path: ["totalCents"],
        message: "totalCents must equal unitPriceCents * quantity",
      });
      return z.NEVER;
    }
    return {
      productId: value.productId,
      merchant: value.merchant,
      category: value.category,
      unitPriceCents: value.unitPriceCents,
      quantity: value.quantity,
      totalCents: computed,
    };
  });

export type PurchaseRequest = z.infer<typeof PurchaseRequestSchema>;

/**
 * Unvalidated shape accepted directly by the pure policy engine so Rule 0
 * can return a structured INVALID_REQUEST denial instead of throwing.
 */
export interface PolicyPurchaseInput {
  productId: string;
  merchant: string;
  category: string;
  unitPriceCents: number;
  quantity: number;
}

export interface PolicyContext {
  mandate: Mandate | null;
  spentThisMonthCents: number;
  now: Date;
}

export const PolicyDecisionKindSchema = z.enum(["APPROVE", "ASK_HUMAN", "DENY"]);
export type PolicyDecisionKind = z.infer<typeof PolicyDecisionKindSchema>;

export const PolicyReasonCodeSchema = z.enum([
  "INVALID_REQUEST",
  "NO_ACTIVE_MANDATE",
  "MERCHANT_BLOCKED",
  "CATEGORY_NOT_ALLOWED",
  "OVER_HARD_LIMIT",
  "OVER_MONTHLY_BUDGET",
  "OVER_AUTO_LIMIT",
  "WITHIN_MANDATE",
]);
export type PolicyReasonCode = z.infer<typeof PolicyReasonCodeSchema>;

export const PolicyRuleResultSchema = z.object({
  rule: NonEmptyTrimmedString,
  code: PolicyReasonCodeSchema,
  passed: z.boolean(),
  detail: z.string(),
});
export type PolicyRuleResult = z.infer<typeof PolicyRuleResultSchema>;

export const PolicyDecisionSchema = z.object({
  decision: PolicyDecisionKindSchema,
  reasonCode: PolicyReasonCodeSchema,
  explanation: NonEmptyTrimmedString,
  remainingBudgetCents: z.number().int(),
  rulesEvaluated: z.array(PolicyRuleResultSchema),
});
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

export const PurchaseStatusSchema = z.enum([
  "pending_approval",
  "approved",
  "captured",
  "rejected",
  "denied",
  "failed",
]);
export type PurchaseStatus = z.infer<typeof PurchaseStatusSchema>;

export const ApprovalStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const AuditActorSchema = z.enum([
  "user",
  "agent",
  "policy",
  "system",
  "paypal",
]);
export type AuditActor = z.infer<typeof AuditActorSchema>;

export const AuditEventTypeSchema = z.enum([
  "MANDATE_PARSED",
  "MANDATE_ACTIVATED",
  "AGENT_REQUEST",
  "PRODUCT_SEARCH",
  "POLICY_DECISION",
  "APPROVAL_REQUESTED",
  "APPROVAL_GRANTED",
  "APPROVAL_REJECTED",
  "PAYPAL_ORDER_CREATED",
  "PAYPAL_CAPTURED",
  "PAYPAL_FAILED",
  "SUSPICIOUS_CONTENT_FLAGGED",
  "DEMO_RESET",
]);
export type AuditEventType = z.infer<typeof AuditEventTypeSchema>;

