import { describe, expect, it } from "vitest";
import { createDatabase } from "@/infra/db/client";
import { createRepositories } from "@/infra/db/repositories";
import { FakePaymentExecutor } from "@/infra/paypal/fake-executor";
import { LocalProductProvider } from "@/infra/products";
import { ApprovalService } from "@/services/approvals";
import { AuditService } from "@/services/audit";
import { PurchaseOrchestrator } from "@/services/orchestrator";

const NOW = new Date("2026-11-11T12:00:00.000Z");

function setupTestHarness(executorMode: "auto-capture" | "redirect" = "auto-capture") {
  const db = createDatabase(":memory:");
  const repos = createRepositories(db);
  const audit = new AuditService(repos.audit, () => NOW);
  const products = new LocalProductProvider();
  const executor = new FakePaymentExecutor({ mode: executorMode });
  const orchestrator = new PurchaseOrchestrator(
    db,
    repos,
    audit,
    products,
    executor,
    { appBaseUrl: "http://localhost:3000", nowFn: () => NOW }
  );
  const approvals = new ApprovalService(db, repos, audit, executor, {
    appBaseUrl: "http://localhost:3000",
    nowFn: () => NOW,
  });

  repos.mandates.insert({
    id: "m-demo",
    status: "active",
    sourceText: "Spend up to $150/month on running gear and nutrition.",
    monthlyCapCents: 15000,
    autoApproveLimitCents: 5000,
    hardLimitCents: 12000,
    allowedCategories: ["running gear", "nutrition"],
    blockedMerchants: ["ShadyDeals"],
    createdAt: "2026-11-01T00:00:00.000Z",
    activatedAt: "2026-11-01T00:01:00.000Z",
  });

  return { db, repos, audit, products, executor, orchestrator, approvals };
}

describe("PurchaseOrchestrator and ApprovalService (T2.4-T2.6, TDD 8.3)", () => {
  it("APPROVE calls executor once, marks purchase captured, and records audit events in order", async () => {
    const { db, repos, audit, executor, orchestrator } = setupTestHarness("auto-capture");

    const result = await orchestrator.requestPurchase({
      productId: "prod-gels-24",
      quantity: 1,
    });

    expect(result.decision.decision).toBe("APPROVE");
    expect(result.purchase.status).toBe("captured");
    expect(result.purchase.paypalOrderId).toBeTruthy();
    expect(executor.createCalls).toHaveLength(1);

    const events = audit.listByPurchaseId(result.purchase.id);
    expect(events.map((e) => e.type)).toEqual([
      "POLICY_DECISION",
      "PAYPAL_ORDER_CREATED",
      "PAYPAL_CAPTURED",
    ]);
    expect(repos.purchases.sumCapturedInUtcMonth(NOW)).toBe(2400);
    db.close();
  });

  it("ASK_HUMAN creates a pending approval record and does not call executor", async () => {
    const { db, repos, audit, executor, orchestrator } = setupTestHarness("auto-capture");

    const result = await orchestrator.requestPurchase({
      productId: "prod-shoes-89",
      quantity: 1,
    });

    expect(result.decision.decision).toBe("ASK_HUMAN");
    expect(result.purchase.status).toBe("pending_approval");
    expect(result.approvalId).toBeTruthy();
    expect(executor.createCalls).toHaveLength(0);

    const approval = repos.approvals.findByPurchaseId(result.purchase.id);
    expect(approval?.status).toBe("pending");

    const events = audit.listByPurchaseId(result.purchase.id);
    expect(events.map((e) => e.type)).toEqual([
      "POLICY_DECISION",
      "APPROVAL_REQUESTED",
    ]);
    db.close();
  });

  it("DENY marks purchase denied and does not call executor", async () => {
    const { db, audit, executor, orchestrator } = setupTestHarness("auto-capture");

    const result = await orchestrator.requestPurchase({
      productId: "prod-watch-249",
      quantity: 1,
    });

    expect(result.decision.decision).toBe("DENY");
    expect(result.decision.reasonCode).toBe("CATEGORY_NOT_ALLOWED");
    expect(result.purchase.status).toBe("denied");
    expect(executor.createCalls).toHaveLength(0);

    const events = audit.listByPurchaseId(result.purchase.id);
    expect(events.map((e) => e.type)).toEqual(["POLICY_DECISION"]);
    db.close();
  });

  it("re-evaluates policy on approve and blocks if monthly budget was consumed meanwhile", async () => {
    const { db, executor, orchestrator, approvals } = setupTestHarness("auto-capture");

    // Request $89 shoes -> pending approval (budget remaining right now: $150)
    const pending = await orchestrator.requestPurchase({
      productId: "prod-shoes-89",
      quantity: 1,
    });
    expect(pending.approvalId).toBeTruthy();

    // Meanwhile consume $70 ($39 + $34? Use $34 gels * 2 = $68? Wait: $45 vest + $24 gels + $26 cap = $95!)
    await orchestrator.requestPurchase({ productId: "prod-vest-45", quantity: 1 });
    await orchestrator.requestPurchase({ productId: "prod-gels-24", quantity: 1 });
    await orchestrator.requestPurchase({ productId: "prod-cap-26", quantity: 1 });
    // Spent so far: $95, remaining: $55 -> $89 shoes now exceed monthly budget!
    const createCountBeforeApprove = executor.createCalls.length;

    const approveOutcome = await approvals.approve(pending.approvalId!);
    expect(approveOutcome.ok).toBe(false);
    if (!approveOutcome.ok) {
      expect(approveOutcome.decision.reasonCode).toBe("OVER_MONTHLY_BUDGET");
    }
    expect(executor.createCalls).toHaveLength(createCountBeforeApprove);
    db.close();
  });

  it("makes repeated Approve clicks idempotent (only one execution)", async () => {
    const { db, executor, orchestrator, approvals } = setupTestHarness("auto-capture");

    const pending = await orchestrator.requestPurchase({
      productId: "prod-shoes-89",
      quantity: 1,
    });

    const first = await approvals.approve(pending.approvalId!);
    const second = await approvals.approve(pending.approvalId!);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(executor.createCalls).toHaveLength(1);
    db.close();
  });

  it("reject sets rejected status, logs APPROVAL_REJECTED, and prevents later approval", async () => {
    const { db, repos, audit, executor, orchestrator, approvals } = setupTestHarness("auto-capture");

    const pending = await orchestrator.requestPurchase({
      productId: "prod-shoes-89",
      quantity: 1,
    });

    const rejected = await approvals.reject(pending.approvalId!);
    expect(rejected.approval.status).toBe("rejected");
    expect(rejected.purchase.status).toBe("rejected");

    const events = audit.listByPurchaseId(pending.purchase.id);
    expect(events.map((e) => e.type)).toEqual([
      "POLICY_DECISION",
      "APPROVAL_REQUESTED",
      "APPROVAL_REJECTED",
    ]);

    await expect(approvals.approve(pending.approvalId!)).rejects.toThrow(/rejected/i);
    expect(executor.createCalls).toHaveLength(0);
    expect(repos.purchases.sumCapturedInUtcMonth(NOW)).toBe(0);
    db.close();
  });

  it("supports Mode B redirect createOrder followed by idempotent capture on return", async () => {
    const { db, repos, audit, executor, orchestrator, approvals } = setupTestHarness("redirect");

    const result = await orchestrator.requestPurchase({
      productId: "prod-gels-24",
      quantity: 1,
    });

    expect(result.purchase.status).toBe("approved");
    expect(result.purchase.paypalOrderId).toBeTruthy();
    expect(result.purchase.paypalApprovalUrl).toContain("sandbox.paypal.com");
    expect(repos.purchases.sumCapturedInUtcMonth(NOW)).toBe(0);

    const captured1 = await approvals.completeOrderCapture(result.purchase.paypalOrderId!);
    const captured2 = await approvals.completeOrderCapture(result.purchase.paypalOrderId!);
    expect(captured1.status).toBe("captured");
    expect(captured2.status).toBe("captured");
    expect(executor.captureCalls).toHaveLength(1);
    expect(repos.purchases.sumCapturedInUtcMonth(NOW)).toBe(2400);

    const events = audit.listByPurchaseId(result.purchase.id);
    expect(events.map((e) => e.type)).toEqual([
      "POLICY_DECISION",
      "PAYPAL_ORDER_CREATED",
      "PAYPAL_CAPTURED",
    ]);
    db.close();
  });
});

