import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "@/domain/policy";
import type { Mandate, PolicyContext, PolicyPurchaseInput } from "@/domain/schemas";

const BASE_NOW = new Date("2026-11-11T12:00:00.000Z");

const ACTIVE_MANDATE: Mandate = {
  id: "mandate-demo",
  status: "active",
  sourceText:
    "Spend up to $150 a month on running gear and nutrition. Buy anything under $50 without asking, ask me for anything up to $120, never buy anything pricier. Don't buy from ShadyDeals.",
  monthlyCapCents: 15000,
  autoApproveLimitCents: 5000,
  hardLimitCents: 12000,
  allowedCategories: ["running gear", "nutrition"],
  blockedMerchants: ["ShadyDeals"],
  createdAt: "2026-11-01T00:00:00.000Z",
  activatedAt: "2026-11-01T00:01:00.000Z",
};

function makeInput(overrides: Partial<PolicyPurchaseInput> = {}): PolicyPurchaseInput {
  return {
    productId: "prod-1",
    merchant: "TrailStore",
    category: "nutrition",
    unitPriceCents: 2400,
    quantity: 1,
    ...overrides,
  };
}

function makeContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    mandate: ACTIVE_MANDATE,
    spentThisMonthCents: 0,
    now: BASE_NOW,
    ...overrides,
  };
}

describe("policy engine (TDD section 8.1)", () => {
  it.each([
    {
      name: "cheap in-category",
      spent: 0,
      input: makeInput({ unitPriceCents: 2400, category: "nutrition" }),
      decision: "APPROVE",
      reasonCode: "WITHIN_MANDATE",
      remainingBudgetCents: 12600,
    },
    {
      name: "exactly at auto limit",
      spent: 0,
      input: makeInput({ unitPriceCents: 5000, category: "running gear" }),
      decision: "APPROVE",
      reasonCode: "WITHIN_MANDATE",
      remainingBudgetCents: 10000,
    },
    {
      name: "one cent over auto limit",
      spent: 0,
      input: makeInput({ unitPriceCents: 5001, category: "running gear" }),
      decision: "ASK_HUMAN",
      reasonCode: "OVER_AUTO_LIMIT",
      remainingBudgetCents: 9999,
    },
    {
      name: "between auto and hard",
      spent: 0,
      input: makeInput({ unitPriceCents: 8900, category: "running gear" }),
      decision: "ASK_HUMAN",
      reasonCode: "OVER_AUTO_LIMIT",
      remainingBudgetCents: 6100,
    },
    {
      name: "exactly at hard limit",
      spent: 0,
      input: makeInput({ unitPriceCents: 12000, category: "running gear" }),
      decision: "ASK_HUMAN",
      reasonCode: "OVER_AUTO_LIMIT",
      remainingBudgetCents: 3000,
    },
    {
      name: "one cent over hard limit",
      spent: 0,
      input: makeInput({ unitPriceCents: 12001, category: "running gear" }),
      decision: "DENY",
      reasonCode: "OVER_HARD_LIMIT",
      remainingBudgetCents: 15000,
    },
    {
      name: "category not allowed",
      spent: 0,
      input: makeInput({ unitPriceCents: 2000, category: "electronics" }),
      decision: "DENY",
      reasonCode: "CATEGORY_NOT_ALLOWED",
      remainingBudgetCents: 15000,
    },
    {
      name: "blocked merchant exact",
      spent: 0,
      input: makeInput({ unitPriceCents: 1000, merchant: "ShadyDeals" }),
      decision: "DENY",
      reasonCode: "MERCHANT_BLOCKED",
      remainingBudgetCents: 15000,
    },
    {
      name: "blocked merchant lowercase",
      spent: 0,
      input: makeInput({ unitPriceCents: 1000, merchant: "shadydeals" }),
      decision: "DENY",
      reasonCode: "MERCHANT_BLOCKED",
      remainingBudgetCents: 15000,
    },
    {
      name: "blocked merchant uppercase with spaces",
      spent: 0,
      input: makeInput({ unitPriceCents: 1000, merchant: "  SHADYDEALS  " }),
      decision: "DENY",
      reasonCode: "MERCHANT_BLOCKED",
      remainingBudgetCents: 15000,
    },
    {
      name: "over remaining monthly budget",
      spent: 11300,
      input: makeInput({ unitPriceCents: 4500, category: "running gear" }),
      decision: "DENY",
      reasonCode: "OVER_MONTHLY_BUDGET",
      remainingBudgetCents: 3700,
    },
    {
      name: "exactly uses remaining monthly budget",
      spent: 11300,
      input: makeInput({ unitPriceCents: 3700, category: "running gear" }),
      decision: "APPROVE",
      reasonCode: "WITHIN_MANDATE",
      remainingBudgetCents: 0,
    },
    {
      name: "quantity multiplies unit price",
      spent: 0,
      input: makeInput({ unitPriceCents: 3000, quantity: 2, category: "nutrition" }),
      decision: "ASK_HUMAN",
      reasonCode: "OVER_AUTO_LIMIT",
      remainingBudgetCents: 9000,
    },
  ])(
    "$name -> $decision ($reasonCode)",
    ({ spent, input, decision, reasonCode, remainingBudgetCents }) => {
      const result = evaluatePolicy(input, makeContext({ spentThisMonthCents: spent }));
      expect(result.decision).toBe(decision);
      expect(result.reasonCode).toBe(reasonCode);
      expect(result.remainingBudgetCents).toBe(remainingBudgetCents);
      expect(result.explanation.length).toBeGreaterThan(0);
    }
  );

  it("denies invalid quantity or price", () => {
    for (const bad of [
      makeInput({ quantity: 0 }),
      makeInput({ quantity: -1 }),
      makeInput({ unitPriceCents: 0 }),
      makeInput({ unitPriceCents: -500 }),
      makeInput({ unitPriceCents: 12.5 }),
      makeInput({ quantity: 1.5 }),
    ]) {
      const result = evaluatePolicy(bad, makeContext());
      expect(result.decision).toBe("DENY");
      expect(result.reasonCode).toBe("INVALID_REQUEST");
    }
  });

  it("denies when there is no active mandate", () => {
    const noMandate = evaluatePolicy(makeInput(), makeContext({ mandate: null }));
    expect(noMandate.decision).toBe("DENY");
    expect(noMandate.reasonCode).toBe("NO_ACTIVE_MANDATE");

    const draftMandate = evaluatePolicy(
      makeInput(),
      makeContext({ mandate: { ...ACTIVE_MANDATE, status: "draft" } })
    );
    expect(draftMandate.decision).toBe("DENY");
    expect(draftMandate.reasonCode).toBe("NO_ACTIVE_MANDATE");
  });

  it("evaluates rules 2-5 and mentions both category and hard limit on multi-failure", () => {
    const result = evaluatePolicy(
      makeInput({ unitPriceCents: 24900, category: "electronics" }),
      makeContext()
    );
    expect(result.decision).toBe("DENY");
    expect(result.reasonCode).toBe("CATEGORY_NOT_ALLOWED");
    expect(result.explanation.toLowerCase()).toContain("category");
    expect(result.explanation.toLowerCase()).toContain("hard limit");

    const failedCodes = result.rulesEvaluated
      .filter((r) => !r.passed)
      .map((r) => r.code);
    expect(failedCodes).toContain("CATEGORY_NOT_ALLOWED");
    expect(failedCodes).toContain("OVER_HARD_LIMIT");
    expect(failedCodes).toContain("OVER_MONTHLY_BUDGET");
  });

  it("is deterministic and does not mutate inputs", () => {
    const frozenMandate: Mandate = {
      ...ACTIVE_MANDATE,
      allowedCategories: Object.freeze([...ACTIVE_MANDATE.allowedCategories]) as string[],
      blockedMerchants: Object.freeze([...ACTIVE_MANDATE.blockedMerchants]) as string[],
    };
    Object.freeze(frozenMandate);
    const frozenInput = Object.freeze(makeInput({ unitPriceCents: 8900 }));
    const frozenContext = Object.freeze(
      makeContext({ mandate: frozenMandate, spentThisMonthCents: 2400 })
    );

    const first = evaluatePolicy(frozenInput, frozenContext);
    const second = evaluatePolicy(frozenInput, frozenContext);
    expect(first).toEqual(second);
  });
});

