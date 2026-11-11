import { describe, expect, it } from "vitest";
import { createDatabase } from "@/infra/db/client";
import { createRepositories } from "@/infra/db/repositories";
import { AuditService } from "@/services/audit";

describe("AuditService (T2.2)", () => {
  it("preserves exact insertion order even within identical timestamps", () => {
    const db = createDatabase(":memory:");
    const repos = createRepositories(db);
    const fixedNow = new Date("2026-11-11T12:00:00.000Z");
    const audit = new AuditService(repos.audit, () => fixedNow);

    db.transaction(() => {
      audit.record({
        type: "POLICY_DECISION",
        actor: "policy",
        purchaseId: "pur-1",
        summary: "Policy asked human",
        payload: { decision: "ASK_HUMAN" },
      });
      audit.record({
        type: "APPROVAL_REQUESTED",
        actor: "system",
        purchaseId: "pur-1",
        summary: "Approval requested",
        payload: { approvalId: "apr-1" },
      });
      audit.record({
        type: "APPROVAL_GRANTED",
        actor: "user",
        purchaseId: "pur-1",
        summary: "User approved",
        payload: { approvalId: "apr-1" },
      });
    });

    const events = audit.listByPurchaseId("pur-1");
    expect(events.map((e) => e.type)).toEqual([
      "POLICY_DECISION",
      "APPROVAL_REQUESTED",
      "APPROVAL_GRANTED",
    ]);
    expect(events.every((e) => e.timestamp === fixedNow.toISOString())).toBe(true);
    db.close();
  });

  it("rolls back audit events when the surrounding transaction fails", () => {
    const db = createDatabase(":memory:");
    const repos = createRepositories(db);
    const audit = new AuditService(repos.audit, () => new Date("2026-11-11T12:00:00.000Z"));

    expect(() =>
      db.transaction(() => {
        audit.record({
          type: "MANDATE_ACTIVATED",
          actor: "user",
          purchaseId: null,
          summary: "Should roll back",
          payload: {},
        });
        throw new Error("simulated failure");
      })
    ).toThrow("simulated failure");

    expect(audit.listAll()).toHaveLength(0);
    db.close();
  });
});

