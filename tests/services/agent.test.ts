import { describe, expect, it, vi } from "vitest";
import { createDatabase } from "@/infra/db/client";
import { createRepositories } from "@/infra/db/repositories";
import { ScriptedLlmClient } from "@/infra/llm/scripted";
import { FakePaymentExecutor } from "@/infra/paypal/fake-executor";
import { LocalProductProvider } from "@/infra/products";
import { AgentService } from "@/services/agent";
import { AuditService } from "@/services/audit";
import { LlmError, type ToolTurnOutput } from "@/services/llm-client";
import { PurchaseOrchestrator } from "@/services/orchestrator";

const ACTIVE_MANDATE = {
  id: "m-1",
  status: "active" as const,
  sourceText:
    "Spend up to $150/month on running gear and nutrition. Auto-approve purchases up to $50. Never spend over $120 on a single purchase, and never buy from ShadyDeals.",
  monthlyCapCents: 15000,
  autoApproveLimitCents: 5000,
  hardLimitCents: 12000,
  allowedCategories: ["running gear", "nutrition"],
  blockedMerchants: ["ShadyDeals"],
  createdAt: "2026-11-11T00:00:00.000Z",
  activatedAt: "2026-11-11T00:01:00.000Z",
};

function toolTurn(id: string, name: string, input: Record<string, unknown>): ToolTurnOutput {
  return {
    stopReason: "tool_use",
    text: "",
    toolCalls: [{ id, name, input }],
    assistantBlocks: [{ type: "tool_use", id, name, input }],
  };
}

function endTurn(text: string): ToolTurnOutput {
  return {
    stopReason: "end_turn",
    text,
    toolCalls: [],
    assistantBlocks: [{ type: "text", text }],
  };
}

describe("AgentService (T4.3, TDD 8.5)", () => {
  function setup(toolTurns: Array<ToolTurnOutput | Error>, nowIso = "2026-11-11T12:00:00.000Z") {
    const db = createDatabase(":memory:");
    const repos = createRepositories(db);
    repos.mandates.insert(ACTIVE_MANDATE);

    const nowFn = () => new Date(nowIso);
    const audit = new AuditService(repos.audit, nowFn);
    const products = new LocalProductProvider();
    const executor = new FakePaymentExecutor({ mode: "auto-capture" });
    const createOrderSpy = vi.spyOn(executor, "createOrder");
    const orchestrator = new PurchaseOrchestrator(
      db,
      repos,
      audit,
      products,
      executor,
      { appBaseUrl: "http://localhost:3000", nowFn }
    );
    const llm = new ScriptedLlmClient({ toolTurns });
    const agent = new AgentService(repos, audit, products, orchestrator, llm, nowFn);
    return { db, repos, audit, createOrderSpy, agent };
  }

  it("runs search then request_purchase for an allowed item and returns decision in reply", async () => {
    const { db, repos, createOrderSpy, agent } = setup([
      toolTurn("tc-1", "search_products", { query: "energy gels" }),
      toolTurn("tc-2", "request_purchase", { productId: "prod-gels-24", quantity: 1 }),
      endTurn("Purchased TrailFuel Energy Gels for $24.00 (approved under $50 auto-approve limit)."),
    ]);

    const res = await agent.chat("Get me a pack of energy gels");

    expect(createOrderSpy).toHaveBeenCalledTimes(1);
    expect(res.reply).toContain("$24.00");
    expect(res.decisions).toHaveLength(1);
    expect(res.decisions[0]?.decision).toBe("APPROVE");
    expect(repos.audit.list().map((e) => e.type)).toContain("AGENT_REQUEST");
    expect(repos.audit.list().map((e) => e.type)).toContain("PRODUCT_SEARCH");
    db.close();
  });

  it("denies out-of-policy purchase attempted by scripted LLM and never calls executor", async () => {
    const { db, createOrderSpy, agent } = setup([
      toolTurn("tc-1", "search_products", { query: "watch" }),
      toolTurn("tc-2", "request_purchase", { productId: "prod-watch-249", quantity: 1 }),
      endTurn("Denied: electronics category is outside your mandate and $249.00 exceeds your $120.00 hard limit."),
    ]);

    const res = await agent.chat("Buy me a GPS sports watch");

    expect(createOrderSpy).not.toHaveBeenCalled();
    expect(res.decisions[0]?.decision).toBe("DENY");
    expect(res.decisions[0]?.reasonCode).toBe("CATEGORY_NOT_ALLOWED");
    expect(res.reply).toContain("Denied");
    db.close();
  });

  it("stops runaway tool loops at max 6 iterations", async () => {
    const infiniteSearches = Array.from({ length: 10 }, (_, idx) =>
      toolTurn(`tc-${idx}`, "search_products", { query: "running" })
    );
    const { db, agent } = setup(infiniteSearches);

    const res = await agent.chat("keep searching forever");

    expect(res.reachedIterationCap).toBe(true);
    expect(res.iterations).toBe(6);
    expect(res.reply).toContain("step limit");
    db.close();
  });

  it("flags injection-bait product with SUSPICIOUS_CONTENT_FLAGGED without altering policy outcome", async () => {
    const { db, repos, createOrderSpy, agent } = setup([
      toolTurn("tc-1", "search_products", { query: "headlamp" }),
      toolTurn("tc-2", "request_purchase", {
        productId: "prod-headlamp-injection",
        quantity: 1,
      }),
      endTurn("Needs your approval: NightTrail Headlamp is $58.00, above your $50.00 auto-approve limit."),
    ]);

    const res = await agent.chat("Get the cheapest headlamp");

    expect(createOrderSpy).not.toHaveBeenCalled();
    expect(res.decisions[0]?.decision).toBe("ASK_HUMAN");
    expect(res.decisions[0]?.reasonCode).toBe("OVER_AUTO_LIMIT");

    const eventTypes = repos.audit.list().map((e) => e.type);
    expect(eventTypes).toContain("SUSPICIOUS_CONTENT_FLAGGED");
    expect(eventTypes).toContain("APPROVAL_REQUESTED");
    db.close();
  });

  it("retries once on a transient LLM error and succeeds", async () => {
    const { db, agent } = setup([
      new LlmError("LLM_TRANSIENT", "Temporary 503", true),
      toolTurn("tc-1", "get_budget", {}),
      endTurn("You have $150.00 remaining this month."),
    ]);

    const res = await agent.chat("What is my budget?");
    expect(res.reply).toContain("$150.00");
    db.close();
  });
});
