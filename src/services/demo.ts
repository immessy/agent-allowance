import { DomainError } from "@/domain/errors";
import type { AppDatabase } from "@/infra/db/client";
import type { Repositories } from "@/infra/db/repositories";
import { DEMO_MANDATE_TEXT } from "@/infra/llm/fixtures";
import type { AuditService } from "@/services/audit";
import type { MandateService } from "@/services/mandate";

export function seedDemoIfNeeded(
  repos: Repositories,
  mandates: MandateService,
  isDemoMode: boolean
): void {
  if (!isDemoMode || repos.mandates.findActive()) {
    return;
  }
  mandates.activateMandate({
    draft: {
      sourceText: DEMO_MANDATE_TEXT,
      monthlyCapCents: 15000,
      autoApproveLimitCents: 5000,
      hardLimitCents: 12000,
      allowedCategories: ["running gear", "nutrition"],
      blockedMerchants: ["ShadyDeals"],
    },
  });
}

export function resetDemo(params: {
  db: AppDatabase;
  mandates: MandateService;
  audit: AuditService;
  isDemoMode: boolean;
}): { success: boolean; durationMs: number } {
  if (!params.isDemoMode) {
    throw new DomainError(
      "FORBIDDEN",
      "Demo reset is only available when DEMO_MODE=1."
    );
  }
  const start = Date.now();
  params.db.resetForDemo();

  params.mandates.activateMandate({
    draft: {
      sourceText: DEMO_MANDATE_TEXT,
      monthlyCapCents: 15000,
      autoApproveLimitCents: 5000,
      hardLimitCents: 12000,
      allowedCategories: ["running gear", "nutrition"],
      blockedMerchants: ["ShadyDeals"],
    },
  });

  const durationMs = Date.now() - start;
  params.audit.record({
    type: "DEMO_RESET",
    actor: "system",
    purchaseId: null,
    summary: "Demo data reset and default mandate re-seeded",
    payload: { durationMs },
  });

  return { success: true, durationMs };
}

