import { describe, expect, it } from "vitest";
import { createDatabase } from "@/infra/db/client";
import { createRepositories } from "@/infra/db/repositories";
import { ScriptedLlmClient } from "@/infra/llm/scripted";
import { AuditService } from "@/services/audit";
import { MandateService } from "@/services/mandate";

describe("MandateService (T4.2)", () => {
  function setup(scriptedResponses: unknown[]) {
    const db = createDatabase(":memory:");
    const repos = createRepositories(db);
    const audit = new AuditService(repos.audit, () => new Date("2026-11-11T12:00:00.000Z"));
    const llm = new ScriptedLlmClient({ structuredResponses: scriptedResponses });
    const service = new MandateService(db, repos, audit, llm, () => new Date("2026-11-11T12:00:00.000Z"));
    return { db, repos, audit, service };
  }

  it("parses a valid mandate into a draft without activating it and logs MANDATE_PARSED", async () => {
    const { db, repos, service } = setup([
      {
        draft: {
          sourceText: "Spend up to $150/month on running gear and nutrition.",
          monthlyCapCents: 15000,
          autoApproveLimitCents: 5000,
          hardLimitCents: 12000,
          allowedCategories: ["running gear", "nutrition"],
          blockedMerchants: ["ShadyDeals"],
        },
        clarifyingQuestion: null,
      },
    ]);

    const result = await service.parseMandate(
      "Spend up to $150/month on running gear and nutrition."
    );

    expect(result.clarifyingQuestion).toBeNull();
    expect(result.mandate?.status).toBe("draft");
    expect(result.mandate?.monthlyCapCents).toBe(15000);
    expect(repos.mandates.findActive()).toBeNull();
    expect(repos.audit.list().map((e) => e.type)).toEqual(["MANDATE_PARSED"]);
    db.close();
  });

  it("retries once when the first structured output fails Zod validation and succeeds on second attempt", async () => {
    const { db, repos, service } = setup([
      {
        // Invalid: hard < auto
        draft: {
          sourceText: "Spend up to $150/month.",
          monthlyCapCents: 15000,
          autoApproveLimitCents: 8000,
          hardLimitCents: 5000,
          allowedCategories: ["running gear"],
          blockedMerchants: [],
        },
        clarifyingQuestion: null,
      },
      {
        draft: {
          sourceText: "Spend up to $150/month.",
          monthlyCapCents: 15000,
          autoApproveLimitCents: 5000,
          hardLimitCents: 8000,
          allowedCategories: ["running gear"],
          blockedMerchants: [],
        },
        clarifyingQuestion: null,
      },
    ]);

    const result = await service.parseMandate("Spend up to $150/month.");
    expect(result.mandate?.hardLimitCents).toBe(8000);
    expect(repos.audit.list()).toHaveLength(1);
    db.close();
  });

  it("throws user-facing error if both initial parse and retry fail Zod validation", async () => {
    const invalidPayload = {
      draft: {
        sourceText: "bad",
        monthlyCapCents: -10,
        autoApproveLimitCents: 5000,
        hardLimitCents: 1000,
        allowedCategories: [],
        blockedMerchants: [],
      },
      clarifyingQuestion: null,
    };
    const { db, service } = setup([invalidPayload, invalidPayload]);

    await expect(service.parseMandate("bad mandate")).rejects.toMatchObject({
      code: "MANDATE_PARSE_FAILED",
    });
    db.close();
  });

  it("returns clarifyingQuestion without creating a draft for ambiguous input", async () => {
    const { db, repos, service } = setup([
      {
        draft: null,
        clarifyingQuestion:
          "What monthly spending cap and allowed categories would you like?",
      },
    ]);

    const result = await service.parseMandate("buy running stuff for me");
    expect(result.mandate).toBeNull();
    expect(result.clarifyingQuestion).toContain("monthly spending cap");
    expect(repos.mandates.findActive()).toBeNull();
    db.close();
  });

  it("activates an edited draft explicitly and reports budget summary", () => {
    const { db, repos, service } = setup([]);

    const active = service.activateMandate({
      draft: {
        sourceText: "Spend up to $150/month on running gear and nutrition.",
        monthlyCapCents: 15000,
        autoApproveLimitCents: 5000,
        hardLimitCents: 12000,
        allowedCategories: ["running gear", "nutrition"],
        blockedMerchants: ["ShadyDeals"],
      },
    });

    expect(active.status).toBe("active");
    expect(repos.mandates.findActive()?.id).toBe(active.id);
    expect(repos.audit.list().map((e) => e.type)).toEqual(["MANDATE_ACTIVATED"]);

    const summary = service.getActiveSummary();
    expect(summary.mandate?.id).toBe(active.id);
    expect(summary.spentThisMonthCents).toBe(0);
    expect(summary.remainingThisMonthCents).toBe(15000);
    db.close();
  });
});
