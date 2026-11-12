import { describe, expect, it, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createContainer, setContainerForTesting } from "@/infra/container";
import { GET as getHealth } from "@/app/api/health/route";
import { GET as getMandate } from "@/app/api/mandate/route";
import { POST as parseMandate } from "@/app/api/mandate/parse/route";
import { POST as activateMandate } from "@/app/api/mandate/activate/route";
import { POST as chatAgent } from "@/app/api/agent/chat/route";
import { GET as getApprovals } from "@/app/api/approvals/route";
import { POST as approveItem } from "@/app/api/approvals/[id]/approve/route";
import { POST as rejectItem } from "@/app/api/approvals/[id]/reject/route";
import { GET as getAudit } from "@/app/api/audit/route";
import { POST as resetDemo } from "@/app/api/demo/reset/route";
import { GET as paypalReturn } from "@/app/api/paypal/connect/return/route";
import { GET as paypalCancel } from "@/app/api/paypal/connect/cancel/route";

describe("API routes (T4.4, T4.5)", () => {
  beforeEach(() => {
    const testContainer = createContainer({
      dbPath: ":memory:",
      mockLlm: true,
      useFakeExecutor: true,
      demoMode: true,
    });
    setContainerForTesting(testContainer);
  });

  it("GET /api/health reports sandbox and mock status", async () => {
    const res = await getHealth();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.paypal.env).toBe("sandbox");
    expect(data.paypal.mode).toBe("B");
    expect(data.llm.mock).toBe(true);
  });

  it("POST /api/mandate/parse returns draft mandate or validation error", async () => {
    const happyReq = new NextRequest("http://localhost:3000/api/mandate/parse", {
      method: "POST",
      body: JSON.stringify({
        text: "Spend up to $150/month on running gear and nutrition.",
      }),
    });
    const happyRes = await parseMandate(happyReq);
    expect(happyRes.status).toBe(200);
    const happyData = await happyRes.json();
    expect(happyData.mandate?.monthlyCapCents).toBe(15000);

    const badReq = new NextRequest("http://localhost:3000/api/mandate/parse", {
      method: "POST",
      body: JSON.stringify({ text: "" }),
    });
    const badRes = await parseMandate(badReq);
    expect(badRes.status).toBe(400);
  });

  it("GET /api/mandate returns active mandate summary", async () => {
    const res = await getMandate();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.mandate?.monthlyCapCents).toBe(15000);
    expect(data.remainingThisMonthCents).toBe(15000);
  });

  it("POST /api/mandate/activate validates draft and activates", async () => {
    const req = new NextRequest("http://localhost:3000/api/mandate/activate", {
      method: "POST",
      body: JSON.stringify({
        draft: {
          sourceText: "Spend up to $200/month.",
          monthlyCapCents: 20000,
          autoApproveLimitCents: 5000,
          hardLimitCents: 10000,
          allowedCategories: ["nutrition"],
          blockedMerchants: [],
        },
      }),
    });
    const res = await activateMandate(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.mandate.monthlyCapCents).toBe(20000);

    // Bad activation payload
    const badReq = new NextRequest("http://localhost:3000/api/mandate/activate", {
      method: "POST",
      body: JSON.stringify({ draft: {} }),
    });
    const badRes = await activateMandate(badReq);
    expect(badRes.status).toBe(400);
  });

  it("POST /api/agent/chat processes user message and returns structured result", async () => {
    const req = new NextRequest("http://localhost:3000/api/agent/chat", {
      method: "POST",
      body: JSON.stringify({ message: "Get me a pack of energy gels" }),
    });
    const res = await chatAgent(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.reply).toContain("$24.00");
    expect(data.decisions[0]?.decision).toBe("APPROVE");
  });

  it("GET /api/approvals and POST approve/reject lifecycle", async () => {
    // Trigger an approval via shoes chat
    const chatReq = new NextRequest("http://localhost:3000/api/agent/chat", {
      method: "POST",
      body: JSON.stringify({ message: "I need trail running shoes" }),
    });
    await chatAgent(chatReq);

    const listRes = await getApprovals();
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(listData.approvals.length).toBeGreaterThanOrEqual(1);

    const approvalId = listData.approvals[0]?.approval.id;
    expect(approvalId).toBeDefined();

    // Approve the item
    const approveRes = await approveItem(
      new NextRequest("http://localhost:3000/api/approvals/test/approve", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: approvalId }) }
    );
    expect(approveRes.status).toBe(200);
    const approveData = await approveRes.json();
    expect(approveData.ok).toBe(true);

    // Reject on already approved item throws conflict (409)
    const rejectRes = await rejectItem(
      new NextRequest("http://localhost:3000/api/approvals/test/reject", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: approvalId }) }
    );
    expect(rejectRes.status).toBe(409);
  });

  it("GET /api/audit lists recorded events and supports type filtering", async () => {
    const res = await getAudit(
      new NextRequest("http://localhost:3000/api/audit?type=DEMO_RESET")
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.events)).toBe(true);
  });

  it("GET /api/paypal/connect/return and cancel handle redirect tokens", async () => {
    const returnReq = new NextRequest(
      "http://localhost:3000/api/paypal/connect/return?token=NONEXISTENT&format=json"
    );
    const returnRes = await paypalReturn(returnReq);
    expect(returnRes.status).toBe(404);

    const cancelReq = new NextRequest(
      "http://localhost:3000/api/paypal/connect/cancel?token=ORD-123&format=json"
    );
    const cancelRes = await paypalCancel(cancelReq);
    expect(cancelRes.status).toBe(200);
    const cancelData = await cancelRes.json();
    expect(cancelData.cancelled).toBe(true);
  });

  it("POST /api/demo/reset resets data and reseeds default mandate", async () => {
    const res = await resetDemo();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });
});

