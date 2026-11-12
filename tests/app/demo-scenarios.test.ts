import { describe, expect, it, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createContainer, setContainerForTesting } from "@/infra/container";
import { POST as chatAgent } from "@/app/api/agent/chat/route";
import { GET as getApprovals } from "@/app/api/approvals/route";
import { POST as approveItem } from "@/app/api/approvals/[id]/approve/route";
import { GET as getMandate } from "@/app/api/mandate/route";

describe("PRD Section 10 Five Demo Scenarios via API (T4.6)", () => {
  beforeEach(() => {
    const testContainer = createContainer({
      dbPath: ":memory:",
      mockLlm: true,
      useFakeExecutor: true,
      demoMode: true,
    });
    setContainerForTesting(testContainer);
  });

  it("Scenario 1: Cheap item ($24 energy gels) auto-approves within mandate", async () => {
    const res = await chatAgent(
      new NextRequest("http://localhost:3000/api/agent/chat", {
        method: "POST",
        body: JSON.stringify({ message: "Get me a pack of energy gels" }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.decisions).toHaveLength(1);
    expect(data.decisions[0]?.decision).toBe("APPROVE");
    expect(data.decisions[0]?.reasonCode).toBe("WITHIN_MANDATE");
    expect(data.purchases[0]?.purchase.status).toBe("captured");

    const mandateRes = await getMandate();
    const mandateData = await mandateRes.json();
    expect(mandateData.spentThisMonthCents).toBe(2400);
    expect(mandateData.remainingThisMonthCents).toBe(12600);
  });

  it("Scenario 2: Medium item ($89 trail shoes) exceeds $50 auto-approve -> ASK_HUMAN -> approved", async () => {
    const res = await chatAgent(
      new NextRequest("http://localhost:3000/api/agent/chat", {
        method: "POST",
        body: JSON.stringify({ message: "I need trail running shoes" }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.decisions[0]?.decision).toBe("ASK_HUMAN");
    expect(data.decisions[0]?.reasonCode).toBe("OVER_AUTO_LIMIT");
    expect(data.purchases[0]?.purchase.status).toBe("pending_approval");

    // Human approves from inbox
    const approvalsRes = await getApprovals();
    const approvalsData = await approvalsRes.json();
    const item = approvalsData.approvals.find(
      (a: { purchase: { title: string } }) =>
        a.purchase.title.includes("Shoes")
    );
    expect(item).toBeDefined();

    const approveRes = await approveItem(
      new NextRequest("http://localhost:3000/api/approvals/approve", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: item.approval.id }) }
    );
    expect(approveRes.status).toBe(200);
    const approveData = await approveRes.json();
    expect(approveData.ok).toBe(true);
    expect(approveData.purchase.status).toBe("captured");
  });

  it("Scenario 3: $249 GPS watch is DENIED (out of category & over hard limit)", async () => {
    const res = await chatAgent(
      new NextRequest("http://localhost:3000/api/agent/chat", {
        method: "POST",
        body: JSON.stringify({ message: "Buy me a GPS sports watch" }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.decisions[0]?.decision).toBe("DENY");
    expect(data.decisions[0]?.reasonCode).toBe("CATEGORY_NOT_ALLOWED");
    expect(data.reply.toLowerCase()).toContain("denied");
  });

  it("Scenario 4: $58 injection-bait headlamp flags SUSPICIOUS_CONTENT and requires approval ($58 > $50)", async () => {
    const res = await chatAgent(
      new NextRequest("http://localhost:3000/api/agent/chat", {
        method: "POST",
        body: JSON.stringify({ message: "Get the cheapest headlamp" }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.decisions[0]?.decision).toBe("ASK_HUMAN");
    expect(data.decisions[0]?.reasonCode).toBe("OVER_AUTO_LIMIT");
  });

  it("Scenario 5: $45 hydration vest is DENIED when remaining budget is $37", async () => {
    // First execute Scenario 1 ($24 captured) and Scenario 2 ($89 captured) -> $113 total
    await chatAgent(
      new NextRequest("http://localhost:3000/api/agent/chat", {
        method: "POST",
        body: JSON.stringify({ message: "Get me a pack of energy gels" }),
      })
    );
    const shoesChat = await chatAgent(
      new NextRequest("http://localhost:3000/api/agent/chat", {
        method: "POST",
        body: JSON.stringify({ message: "I need trail running shoes" }),
      })
    );
    const shoesData = await shoesChat.json();
    const approvalId = shoesData.purchases[0]?.approvalId;
    await approveItem(
      new NextRequest("http://localhost:3000/api/approvals/approve", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: approvalId }) }
    );

    const mandateRes = await getMandate();
    const mandateData = await mandateRes.json();
    expect(mandateData.spentThisMonthCents).toBe(11300);
    expect(mandateData.remainingThisMonthCents).toBe(3700);

    // Now attempt $45 vest -> $45 > $37 remaining -> DENIED
    const vestRes = await chatAgent(
      new NextRequest("http://localhost:3000/api/agent/chat", {
        method: "POST",
        body: JSON.stringify({ message: "Get a $45 hydration vest" }),
      })
    );
    expect(vestRes.status).toBe(200);
    const vestData = await vestRes.json();
    expect(vestData.decisions[0]?.decision).toBe("DENY");
    expect(vestData.decisions[0]?.reasonCode).toBe("OVER_MONTHLY_BUDGET");
    expect(vestData.decisions[0]?.remainingBudgetCents).toBe(3700);
  });
});

