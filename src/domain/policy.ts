import {
  formatCentsToUsd,
  multiplyCents,
  subtractCents,
} from "./money";
import type {
  Mandate,
  PolicyContext,
  PolicyDecision,
  PolicyPurchaseInput,
  PolicyReasonCode,
  PolicyRuleResult,
} from "./schemas";

interface RuleEvaluation {
  rule: string;
  code: PolicyReasonCode;
  passed: boolean;
  detail: string;
  failureMessage: string;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function isValidPurchaseInput(
  input: PolicyPurchaseInput,
  spentThisMonthCents: number
): boolean {
  return (
    input.productId.trim().length > 0 &&
    input.merchant.trim().length > 0 &&
    input.category.trim().length > 0 &&
    Number.isSafeInteger(input.unitPriceCents) &&
    input.unitPriceCents > 0 &&
    Number.isSafeInteger(input.quantity) &&
    input.quantity >= 1 &&
    Number.isSafeInteger(spentThisMonthCents) &&
    spentThisMonthCents >= 0
  );
}

function evaluateCoreRules(
  input: PolicyPurchaseInput,
  totalCents: number,
  mandate: Mandate,
  remainingBeforeCents: number
): RuleEvaluation[] {
  const merchantNormalized = normalizeText(input.merchant);
  const categoryNormalized = normalizeText(input.category);

  const isMerchantBlocked = mandate.blockedMerchants.some(
    (blocked) => normalizeText(blocked) === merchantNormalized
  );
  const isCategoryAllowed = mandate.allowedCategories.some(
    (allowed) => normalizeText(allowed) === categoryNormalized
  );
  const withinHardLimit = totalCents <= mandate.hardLimitCents;
  const withinMonthlyBudget = totalCents <= remainingBeforeCents;

  return [
    {
      rule: "blocked_merchant",
      code: "MERCHANT_BLOCKED",
      passed: !isMerchantBlocked,
      detail: isMerchantBlocked
        ? `merchant "${input.merchant.trim()}" is blocked`
        : `merchant "${input.merchant.trim()}" is not blocked`,
      failureMessage: `merchant "${input.merchant.trim()}" is blocked`,
    },
    {
      rule: "allowed_category",
      code: "CATEGORY_NOT_ALLOWED",
      passed: isCategoryAllowed,
      detail: isCategoryAllowed
        ? `category "${input.category.trim()}" is allowed`
        : `category "${input.category.trim()}" is outside allowed categories (${mandate.allowedCategories.join(", ")})`,
      failureMessage: `category "${input.category.trim()}" is not in allowed categories (${mandate.allowedCategories.join(", ")})`,
    },
    {
      rule: "hard_limit",
      code: "OVER_HARD_LIMIT",
      passed: withinHardLimit,
      detail: `${formatCentsToUsd(totalCents)} vs hard limit ${formatCentsToUsd(mandate.hardLimitCents)}`,
      failureMessage: `total ${formatCentsToUsd(totalCents)} exceeds per-item hard limit of ${formatCentsToUsd(mandate.hardLimitCents)}`,
    },
    {
      rule: "monthly_budget",
      code: "OVER_MONTHLY_BUDGET",
      passed: withinMonthlyBudget,
      detail: `${formatCentsToUsd(totalCents)} vs remaining ${formatCentsToUsd(Math.max(0, remainingBeforeCents))}`,
      failureMessage: `total ${formatCentsToUsd(totalCents)} exceeds remaining monthly budget of ${formatCentsToUsd(Math.max(0, remainingBeforeCents))}`,
    },
  ];
}

function toRuleResult(ev: RuleEvaluation): PolicyRuleResult {
  return {
    rule: ev.rule,
    code: ev.code,
    passed: ev.passed,
    detail: ev.detail,
  };
}

/**
 * Pure, deterministic spending policy evaluator.
 * Evaluates rules 0-7 in strict TDD order; rules 2-5 are all checked and recorded
 * so compound denials expose every violated guardrail.
 */
export function evaluatePolicy(
  input: PolicyPurchaseInput,
  context: PolicyContext
): PolicyDecision {
  // Rule 0: Invalid request
  if (!isValidPurchaseInput(input, context.spentThisMonthCents)) {
    const remaining =
      context.mandate && context.mandate.status === "active"
        ? Math.max(
            0,
            subtractCents(
              context.mandate.monthlyCapCents,
              Number.isSafeInteger(context.spentThisMonthCents)
                ? Math.max(0, context.spentThisMonthCents)
                : 0
            )
          )
        : 0;
    return {
      decision: "DENY",
      reasonCode: "INVALID_REQUEST",
      explanation:
        "Denied: invalid purchase request (quantity must be >= 1 and unit price > $0.00).",
      remainingBudgetCents: remaining,
      rulesEvaluated: [
        {
          rule: "valid_request",
          code: "INVALID_REQUEST",
          passed: false,
          detail: "quantity < 1, unitPriceCents <= 0, or missing fields",
        },
      ],
    };
  }

  // Rule 1: Active mandate required
  if (!context.mandate || context.mandate.status !== "active") {
    return {
      decision: "DENY",
      reasonCode: "NO_ACTIVE_MANDATE",
      explanation: "Denied: no active spending mandate is configured.",
      remainingBudgetCents: 0,
      rulesEvaluated: [
        {
          rule: "valid_request",
          code: "INVALID_REQUEST",
          passed: true,
          detail: "request fields valid",
        },
        {
          rule: "active_mandate",
          code: "NO_ACTIVE_MANDATE",
          passed: false,
          detail: context.mandate
            ? `mandate status is "${context.mandate.status}"`
            : "mandate is null",
        },
      ],
    };
  }

  const { mandate } = context;
  const totalCents = multiplyCents(input.unitPriceCents, input.quantity);
  const remainingBeforeCents = subtractCents(
    mandate.monthlyCapCents,
    context.spentThisMonthCents
  );

  const prefixRules: PolicyRuleResult[] = [
    {
      rule: "valid_request",
      code: "INVALID_REQUEST",
      passed: true,
      detail: `${input.quantity} x ${formatCentsToUsd(input.unitPriceCents)} = ${formatCentsToUsd(totalCents)}`,
    },
    {
      rule: "active_mandate",
      code: "NO_ACTIVE_MANDATE",
      passed: true,
      detail: `mandate ${mandate.id} active`,
    },
  ];

  // Rules 2-5: check all and record all failures; first failing rule sets primary reasonCode
  const coreEvaluations = evaluateCoreRules(
    input,
    totalCents,
    mandate,
    remainingBeforeCents
  );
  const rulesEvaluated: PolicyRuleResult[] = [
    ...prefixRules,
    ...coreEvaluations.map(toRuleResult),
  ];

  const failedCore = coreEvaluations.filter((rule) => !rule.passed);
  const firstFailure = failedCore[0];
  if (firstFailure) {
    return {
      decision: "DENY",
      reasonCode: firstFailure.code,
      explanation: `Denied: ${failedCore.map((f) => f.failureMessage).join("; ")}.`,
      remainingBudgetCents: Math.max(0, remainingBeforeCents),
      rulesEvaluated,
    };
  }

  const remainingAfterCents = subtractCents(remainingBeforeCents, totalCents);

  // Rule 6: Over auto-approve limit -> ASK_HUMAN
  if (totalCents > mandate.autoApproveLimitCents) {
    rulesEvaluated.push({
      rule: "auto_approve_limit",
      code: "OVER_AUTO_LIMIT",
      passed: false,
      detail: `${formatCentsToUsd(totalCents)} > ${formatCentsToUsd(mandate.autoApproveLimitCents)}`,
    });
    return {
      decision: "ASK_HUMAN",
      reasonCode: "OVER_AUTO_LIMIT",
      explanation: `Needs human approval: ${formatCentsToUsd(totalCents)} exceeds auto-approve limit of ${formatCentsToUsd(mandate.autoApproveLimitCents)} (within ${formatCentsToUsd(mandate.hardLimitCents)} hard limit; ${formatCentsToUsd(remainingAfterCents)} monthly budget would remain).`,
      remainingBudgetCents: remainingAfterCents,
      rulesEvaluated,
    };
  }

  // Rule 7: Otherwise -> APPROVE
  rulesEvaluated.push({
    rule: "auto_approve_limit",
    code: "WITHIN_MANDATE",
    passed: true,
    detail: `${formatCentsToUsd(totalCents)} <= ${formatCentsToUsd(mandate.autoApproveLimitCents)}`,
  });
  return {
    decision: "APPROVE",
    reasonCode: "WITHIN_MANDATE",
    explanation: `Approved: ${formatCentsToUsd(totalCents)} is within the ${formatCentsToUsd(mandate.autoApproveLimitCents)} auto-approve limit (${formatCentsToUsd(remainingAfterCents)} monthly budget remaining).`,
    remainingBudgetCents: remainingAfterCents,
    rulesEvaluated,
  };
}
