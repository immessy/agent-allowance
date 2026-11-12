import { describe, expect, it } from "vitest";
import { createDatabase } from "@/infra/db/client";
import { createRepositories } from "@/infra/db/repositories";
import { handleScenarioStructuredParse } from "@/infra/llm/fixtures";
import { ScriptedLlmClient } from "@/infra/llm/scripted";
import { AuditService } from "@/services/audit";
import { resetDemo, seedDemoIfNeeded } from "@/services/demo";
import { MandateService } from "@/services/mandate";

describe("Demo seed and reset (T4.5)", () => {
  it("seeds active mandate when DEMO_MODE is enabled and resets cleanly under 2s", () => {
    const db = createDatabase(":memory:");
    const repos = createRepositories(db);
    const audit = new AuditService(repos.audit);
    const llm = new ScriptedLlmClient({
      structuredHandler: handleScenarioStructuredParse,
    });
    const mandates = new MandateService(db, repos, audit, llm);

    seedDemoIfNeeded(repos, mandates, true);
    expect(repos.mandates.findActive()?.monthlyCapCents).toBe(15000);

    const res = resetDemo({ db, mandates, audit, isDemoMode: true });
    expect(res.success).toBe(true);
    expect(res.durationMs).toBeLessThan(2000);
    expect(repos.mandates.findActive()?.monthlyCapCents).toBe(15000);
    expect(repos.audit.list().map((e) => e.type)).toContain("DEMO_RESET");
    db.close();
  });

  it("refuses reset when DEMO_MODE is disabled", () => {
    const db = createDatabase(":memory:");
    const repos = createRepositories(db);
    const audit = new AuditService(repos.audit);
    const llm = new ScriptedLlmClient();
    const mandates = new MandateService(db, repos, audit, llm);

    expect(() =>
      resetDemo({ db, mandates, audit, isDemoMode: false })
    ).toThrow(/DEMO_MODE=1/);
    db.close();
  });
});

