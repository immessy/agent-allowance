import { describe, expect, it } from "vitest";
import {
  AuditEventTypeSchema,
  MandateDraftSchema,
  MandateSchema,
  PolicyDecisionSchema,
  ProductSchema,
  PurchaseRequestSchema,
  getMandateWarnings,
} from "@/domain/schemas";

describe("domain schemas", () => {
  const validMandate = {
    id: "m-1",
    status: "active" as const,
    sourceText:
      "Spend up to $150 a month on running gear and nutrition. Auto under $50, ask up to $120. Block ShadyDeals.",
    monthlyCapCents: 15000,
    autoApproveLimitCents: 5000,
    hardLimitCents: 12000,
    allowedCategories: ["running gear", "nutrition"],
    blockedMerchants: ["ShadyDeals"],
    createdAt: "2026-11-11T00:00:00.000Z",
    activatedAt: "2026-11-11T00:01:00.000Z",
  };

  it("accepts a valid mandate", () => {
    const parsed = MandateSchema.safeParse(validMandate);
    expect(parsed.success).toBe(true);
    expect(getMandateWarnings(validMandate)).toEqual([]);
  });

  it("rejects hardLimitCents below autoApproveLimitCents", () => {
    const parsed = MandateDraftSchema.safeParse({
      sourceText: "test",
      monthlyCapCents: 15000,
      autoApproveLimitCents: 6000,
      hardLimitCents: 5000,
      allowedCategories: ["nutrition"],
      blockedMerchants: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects empty allowedCategories, non-integer cents, and negative values", () => {
    expect(
      MandateDraftSchema.safeParse({
        sourceText: "test",
        monthlyCapCents: 15000,
        autoApproveLimitCents: 5000,
        hardLimitCents: 12000,
        allowedCategories: [],
        blockedMerchants: [],
      }).success
    ).toBe(false);

    expect(
      MandateDraftSchema.safeParse({
        sourceText: "test",
        monthlyCapCents: 150.5,
        autoApproveLimitCents: 5000,
        hardLimitCents: 12000,
        allowedCategories: ["nutrition"],
        blockedMerchants: [],
      }).success
    ).toBe(false);

    expect(
      MandateDraftSchema.safeParse({
        sourceText: "test",
        monthlyCapCents: 0,
        autoApproveLimitCents: -1,
        hardLimitCents: 12000,
        allowedCategories: ["nutrition"],
        blockedMerchants: [],
      }).success
    ).toBe(false);
  });

  it("allows monthlyCapCents below hardLimitCents and flags a warning", () => {
    const draft = {
      sourceText: "test",
      monthlyCapCents: 10000,
      autoApproveLimitCents: 5000,
      hardLimitCents: 12000,
      allowedCategories: ["nutrition"],
      blockedMerchants: [],
    };
    const parsed = MandateDraftSchema.safeParse(draft);
    expect(parsed.success).toBe(true);
    expect(getMandateWarnings(draft).length).toBeGreaterThan(0);
  });

  it("validates Product, PurchaseRequest, PolicyDecision, and AuditEventType schemas", () => {
    expect(
      ProductSchema.safeParse({
        id: "prod-gels",
        title: "Trail Energy Gels (12-pack)",
        description: "Electrolyte energy gels",
        priceCents: 2400,
        category: "nutrition",
        merchant: "TrailFuel",
        imageEmoji: "⚡",
        flags: [],
      }).success
    ).toBe(true);

    const req = PurchaseRequestSchema.safeParse({
      productId: "prod-gels",
      merchant: "TrailFuel",
      category: "nutrition",
      unitPriceCents: 2400,
      quantity: 2,
    });
    expect(req.success).toBe(true);
    if (req.success) {
      expect(req.data.totalCents).toBe(4800);
    }

    expect(
      PolicyDecisionSchema.safeParse({
        decision: "APPROVE",
        reasonCode: "WITHIN_MANDATE",
        explanation: "Approved $24.00 within $50.00 auto-approve limit.",
        remainingBudgetCents: 12600,
        rulesEvaluated: [
          {
            rule: "auto_approve_limit",
            code: "WITHIN_MANDATE",
            passed: true,
            detail: "2400 <= 5000",
          },
        ],
      }).success
    ).toBe(true);

    expect(AuditEventTypeSchema.safeParse("PAYPAL_CAPTURED").success).toBe(true);
    expect(AuditEventTypeSchema.safeParse("UNKNOWN_EVENT").success).toBe(false);
  });
});
