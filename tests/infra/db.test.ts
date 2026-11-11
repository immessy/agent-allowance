import { describe, expect, it } from "vitest";
import { createDatabase } from "@/infra/db/client";
import { createRepositories } from "@/infra/db/repositories";

describe("SQLite database layer (T2.1)", () => {
  it("runs migrations idempotently and manages mandates", () => {
    const db = createDatabase(":memory:");
    db.migrate();
    const repos = createRepositories(db);

    const m1 = repos.mandates.insert({
      id: "m-1",
      status: "active",
      sourceText: "Spend up to $150/month on running gear and nutrition.",
      monthlyCapCents: 15000,
      autoApproveLimitCents: 5000,
      hardLimitCents: 12000,
      allowedCategories: ["running gear", "nutrition"],
      blockedMerchants: ["ShadyDeals"],
      createdAt: "2026-11-11T00:00:00.000Z",
      activatedAt: "2026-11-11T00:01:00.000Z",
    });

    expect(m1.id).toBe("m-1");
    expect(repos.mandates.findActive()?.id).toBe("m-1");

    repos.mandates.insert({
      id: "m-2",
      status: "draft",
      sourceText: "Spend up to $200/month.",
      monthlyCapCents: 20000,
      autoApproveLimitCents: 5000,
      hardLimitCents: 10000,
      allowedCategories: ["nutrition"],
      blockedMerchants: [],
      createdAt: "2026-11-11T01:00:00.000Z",
      activatedAt: null,
    });
    repos.mandates.activate("m-2", "2026-11-11T01:05:00.000Z");

    expect(repos.mandates.findActive()?.id).toBe("m-2");
    expect(repos.mandates.findById("m-1")?.status).toBe("archived");
    db.close();
  });

  it("sums captured purchases strictly within the UTC month window", () => {
    const db = createDatabase(":memory:");
    const repos = createRepositories(db);

    repos.purchases.insert({
      id: "p-prev-month",
      mandateId: "m-1",
      productId: "prod-1",
      title: "Gels",
      merchant: "TrailFuel",
      category: "nutrition",
      quantity: 1,
      unitPriceCents: 2400,
      totalCents: 2400,
      status: "captured",
      policyDecision: {
        decision: "APPROVE",
        reasonCode: "WITHIN_MANDATE",
        explanation: "ok",
        remainingBudgetCents: 12600,
        rulesEvaluated: [],
      },
      paypalOrderId: "ORD-PREV",
      paypalApprovalUrl: null,
      createdAt: "2026-10-31T23:59:59.000Z",
      updatedAt: "2026-10-31T23:59:59.000Z",
      capturedAt: "2026-10-31T23:59:59.000Z",
    });

    repos.purchases.insert({
      id: "p-curr-month",
      mandateId: "m-1",
      productId: "prod-2",
      title: "Shoes",
      merchant: "TrailRun",
      category: "running gear",
      quantity: 1,
      unitPriceCents: 8900,
      totalCents: 8900,
      status: "captured",
      policyDecision: {
        decision: "ASK_HUMAN",
        reasonCode: "OVER_AUTO_LIMIT",
        explanation: "ok",
        remainingBudgetCents: 6100,
        rulesEvaluated: [],
      },
      paypalOrderId: "ORD-CURR",
      paypalApprovalUrl: null,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
      capturedAt: "2026-11-01T00:00:00.000Z",
    });

    repos.purchases.insert({
      id: "p-pending",
      mandateId: "m-1",
      productId: "prod-3",
      title: "Vest",
      merchant: "TrailRun",
      category: "running gear",
      quantity: 1,
      unitPriceCents: 4500,
      totalCents: 4500,
      status: "pending_approval",
      policyDecision: {
        decision: "ASK_HUMAN",
        reasonCode: "OVER_AUTO_LIMIT",
        explanation: "pending",
        remainingBudgetCents: 1600,
        rulesEvaluated: [],
      },
      paypalOrderId: null,
      paypalApprovalUrl: null,
      createdAt: "2026-11-11T00:00:00.000Z",
      updatedAt: "2026-11-11T00:00:00.000Z",
      capturedAt: null,
    });

    expect(
      repos.purchases.sumCapturedInUtcMonth(new Date("2026-11-11T12:00:00.000Z"))
    ).toBe(8900);
    expect(
      repos.purchases.sumCapturedInUtcMonth(new Date("2026-10-31T23:59:59.000Z"))
    ).toBe(2400);
    db.close();
  });

  it("enforces append-only audit repository with insert and read methods only", () => {
    const db = createDatabase(":memory:");
    const repos = createRepositories(db);

    const auditKeys = Object.keys(repos.audit);
    expect(auditKeys).not.toContain("update");
    expect(auditKeys).not.toContain("delete");
    expect(auditKeys).not.toContain("remove");

    repos.audit.insert({
      id: "evt-1",
      timestamp: "2026-11-11T10:00:00.000Z",
      type: "MANDATE_ACTIVATED",
      purchaseId: null,
      actor: "user",
      summary: "Mandate activated",
      payload: { mandateId: "m-1" },
    });

    const events = repos.audit.list();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("MANDATE_ACTIVATED");
    expect(events[0]?.payload).toEqual({ mandateId: "m-1" });
    db.close();
  });
});
import { describe, expect, it } from "vitest";
import { createDatabase } from "@/infra/db/client";
import { createRepositories } from "@/infra/db/repositories";

describe("SQLite database layer (T2.1)", () => {
  it("runs migrations idempotently and manages mandates", () => {
    const db = createDatabase(":memory:");
    db.migrate();
    const repos = createRepositories(db);

    const m1 = repos.mandates.insert({
      id: "m-1",
      status: "active",
      sourceText: "Spend up to $150/month on running gear and nutrition.",
      monthlyCapCents: 15000,
      autoApproveLimitCents: 5000,
      hardLimitCents: 12000,
      allowedCategories: ["running gear", "nutrition"],
      blockedMerchants: ["ShadyDeals"],
      createdAt: "2026-11-11T00:00:00.000Z",
      activatedAt: "2026-11-11T00:01:00.000Z",
    });

    expect(m1.id).toBe("m-1");
    expect(repos.mandates.findActive()?.id).toBe("m-1");

    repos.mandates.insert({
      id: "m-2",
      status: "draft",
      sourceText: "Spend up to $200/month.",
      monthlyCapCents: 20000,
      autoApproveLimitCents: 5000,
      hardLimitCents: 10000,
      allowedCategories: ["nutrition"],
      blockedMerchants: [],
      createdAt: "2026-11-11T01:00:00.000Z",
      activatedAt: null,
    });
    repos.mandates.activate("m-2", "2026-11-11T01:05:00.000Z");

    expect(repos.mandates.findActive()?.id).toBe("m-2");
    expect(repos.mandates.findById("m-1")?.status).toBe("archived");
    db.close();
  });

  it("sums captured purchases strictly within the UTC month window", () => {
    const db = createDatabase(":memory:");
    const repos = createRepositories(db);

    repos.purchases.insert({
      id: "p-prev-month",
      mandateId: "m-1",
      productId: "prod-1",
      title: "Gels",
      merchant: "TrailFuel",
      category: "nutrition",
      quantity: 1,
      unitPriceCents: 2400,
      totalCents: 2400,
      status: "captured",
      policyDecision: {
        decision: "APPROVE",
        reasonCode: "WITHIN_MANDATE",
        explanation: "ok",
        remainingBudgetCents: 12600,
        rulesEvaluated: [],
      },
      paypalOrderId: "ORD-PREV",
      paypalApprovalUrl: null,
      createdAt: "2026-10-31T23:59:59.000Z",
      updatedAt: "2026-10-31T23:59:59.000Z",
      capturedAt: "2026-10-31T23:59:59.000Z",
    });

    repos.purchases.insert({
      id: "p-curr-month",
      mandateId: "m-1",
      productId: "prod-2",
      title: "Shoes",
      merchant: "TrailRun",
      category: "running gear",
      quantity: 1,
      unitPriceCents: 8900,
      totalCents: 8900,
      status: "captured",
      policyDecision: {
        decision: "ASK_HUMAN",
        reasonCode: "OVER_AUTO_LIMIT",
        explanation: "ok",
        remainingBudgetCents: 6100,
        rulesEvaluated: [],
      },
      paypalOrderId: "ORD-CURR",
      paypalApprovalUrl: null,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
      capturedAt: "2026-11-01T00:00:00.000Z",
    });

    repos.purchases.insert({
      id: "p-pending",
      mandateId: "m-1",
      productId: "prod-3",
      title: "Vest",
      merchant: "TrailRun",
      category: "running gear",
      quantity: 1,
      unitPriceCents: 4500,
      totalCents: 4500,
      status: "pending_approval",
      policyDecision: {
        decision: "ASK_HUMAN",
        reasonCode: "OVER_AUTO_LIMIT",
        explanation: "pending",
        remainingBudgetCents: 1600,
        rulesEvaluated: [],
      },
      paypalOrderId: null,
      paypalApprovalUrl: null,
      createdAt: "2026-11-11T00:00:00.000Z",
      updatedAt: "2026-11-11T00:00:00.000Z",
      capturedAt: null,
    });

    expect(
      repos.purchases.sumCapturedInUtcMonth(new Date("2026-11-11T12:00:00.000Z"))
    ).toBe(8900);
    expect(
      repos.purchases.sumCapturedInUtcMonth(new Date("2026-10-31T23:59:59.000Z"))
    ).toBe(2400);
    db.close();
  });

  it("enforces append-only audit repository with insert and read methods only", () => {
    const db = createDatabase(":memory:");
    const repos = createRepositories(db);

    const auditKeys = Object.keys(repos.audit);
    expect(auditKeys).not.toContain("update");
    expect(auditKeys).not.toContain("delete");
    expect(auditKeys).not.toContain("remove");

    repos.audit.insert({
      id: "evt-1",
      timestamp: "2026-11-11T10:00:00.000Z",
      type: "MANDATE_ACTIVATED",
      purchaseId: null,
      actor: "user",
      summary: "Mandate activated",
      payload: { mandateId: "m-1" },
    });

    const events = repos.audit.list();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("MANDATE_ACTIVATED");
    expect(events[0]?.payload).toEqual({ mandateId: "m-1" });
    db.close();
  });
});

