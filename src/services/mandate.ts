import { randomUUID } from "node:crypto";
import { DomainError } from "@/domain/errors";
import { formatCentsToUsd, subtractCents, type Cents } from "@/domain/money";
import {
  getMandateWarnings,
  MandateDraftSchema,
  MandateParseOutputSchema,
  type Mandate,
  type MandateDraft,
  type MandateParseOutput,
} from "@/domain/schemas";
import type { AppDatabase } from "@/infra/db/client";
import type { Repositories } from "@/infra/db/repositories";
import type { AuditService } from "@/services/audit";
import { LlmError, type LlmClient } from "@/services/llm-client";

export interface ParseMandateResult {
  mandate: Mandate | null;
  clarifyingQuestion: string | null;
  warnings: string[];
}

export interface ActiveMandateSummary {
  mandate: Mandate | null;
  spentThisMonthCents: Cents;
  remainingThisMonthCents: Cents;
  pendingCount: number;
  pendingTotalCents: Cents;
  warnings: string[];
}

const MANDATE_PARSER_SYSTEM_PROMPT = `You extract a structured spending mandate from natural-language instructions.
Output JSON matching the schema:
- Convert all USD dollar amounts to integer cents (e.g. $150 -> 15000, $50 -> 5000, $120 -> 12000).
- sourceText: copy the user's original mandate text cleanly.
- monthlyCapCents: monthly spending limit in integer cents.
- autoApproveLimitCents: purchases up to this amount require no human approval (defaults to 0 if user wants all purchases approved manually).
- hardLimitCents: single-purchase maximum in integer cents (must be >= autoApproveLimitCents; if omitted and a monthly cap is specified, set equal to monthlyCapCents).
- allowedCategories: lowercase list of permitted categories (at least 1 non-empty category).
- blockedMerchants: list of excluded merchant/vendor names (empty array if none).
- If the request is ambiguous or missing either a monthly cap or any allowed categories, set draft to null and provide a concise clarifyingQuestion asking only for the missing bounds.`;

/**
 * Parses natural-language spending rules into draft mandates and handles explicit activation.
 */
export class MandateService {
  constructor(
    private readonly db: AppDatabase,
    private readonly repos: Repositories,
    private readonly audit: AuditService,
    private readonly llm: LlmClient,
    private readonly nowFn: () => Date = () => new Date()
  ) {}

  async parseMandate(rawText: string): Promise<ParseMandateResult> {
    const sourceText = rawText.trim();
    if (!sourceText) {
      throw new DomainError(
        "INVALID_INPUT",
        "Mandate text cannot be empty."
      );
    }

    const parsed = await this.parseWithSingleRetry(sourceText);

    if (!parsed.draft) {
      const clarifyingQuestion =
        parsed.clarifyingQuestion ??
        "Could you specify your monthly cap and allowed spending categories?";

      this.audit.record({
        type: "MANDATE_PARSED",
        actor: "user",
        purchaseId: null,
        summary: "Mandate parsing requested clarification",
        payload: {
          status: "needs_clarification",
          clarifyingQuestion,
        },
      });

      return {
        mandate: null,
        clarifyingQuestion,
        warnings: [],
      };
    }

    const nowIso = this.nowFn().toISOString();
    const mandate: Mandate = {
      id: randomUUID(),
      status: "draft",
      sourceText: parsed.draft.sourceText || sourceText,
      monthlyCapCents: parsed.draft.monthlyCapCents,
      autoApproveLimitCents: parsed.draft.autoApproveLimitCents,
      hardLimitCents: parsed.draft.hardLimitCents,
      allowedCategories: parsed.draft.allowedCategories,
      blockedMerchants: parsed.draft.blockedMerchants,
      createdAt: nowIso,
      activatedAt: null,
    };

    const warnings = getMandateWarnings(mandate);

    this.db.transaction(() => {
      this.repos.mandates.insert(mandate);
      this.audit.record({
        type: "MANDATE_PARSED",
        actor: "user",
        purchaseId: null,
        summary: `Parsed draft mandate (${formatCentsToUsd(mandate.monthlyCapCents)}/mo cap)`,
        payload: {
          mandateId: mandate.id,
          status: mandate.status,
          monthlyCapCents: mandate.monthlyCapCents,
          autoApproveLimitCents: mandate.autoApproveLimitCents,
          hardLimitCents: mandate.hardLimitCents,
          warnings,
        },
      });
    });

    return {
      mandate,
      clarifyingQuestion: null,
      warnings,
    };
  }

  activateMandate(input: { draft: MandateDraft }): Mandate {
    const validatedDraft = MandateDraftSchema.safeParse(input.draft);
    if (!validatedDraft.success) {
      throw new DomainError(
        "INVALID_MANDATE",
        validatedDraft.error.issues.map((i) => i.message).join("; ")
      );
    }

    const nowIso = this.nowFn().toISOString();
    const mandate: Mandate = {
      id: randomUUID(),
      status: "draft",
      sourceText: validatedDraft.data.sourceText,
      monthlyCapCents: validatedDraft.data.monthlyCapCents,
      autoApproveLimitCents: validatedDraft.data.autoApproveLimitCents,
      hardLimitCents: validatedDraft.data.hardLimitCents,
      allowedCategories: validatedDraft.data.allowedCategories,
      blockedMerchants: validatedDraft.data.blockedMerchants,
      createdAt: nowIso,
      activatedAt: null,
    };

    return this.db.transaction(() => {
      this.repos.mandates.insert(mandate);
      const active = this.repos.mandates.activate(mandate.id, nowIso);
      if (!active) {
        throw new DomainError("NOT_FOUND", "Failed to activate mandate.");
      }
      this.audit.record({
        type: "MANDATE_ACTIVATED",
        actor: "user",
        purchaseId: null,
        summary: `Activated mandate: ${formatCentsToUsd(active.monthlyCapCents)}/mo cap, auto up to ${formatCentsToUsd(active.autoApproveLimitCents)}, hard limit ${formatCentsToUsd(active.hardLimitCents)}`,
        payload: {
          mandateId: active.id,
          monthlyCapCents: active.monthlyCapCents,
          autoApproveLimitCents: active.autoApproveLimitCents,
          hardLimitCents: active.hardLimitCents,
          allowedCategories: active.allowedCategories,
          blockedMerchants: active.blockedMerchants,
        },
      });
      return active;
    });
  }

  getActiveSummary(): ActiveMandateSummary {
    const now = this.nowFn();
    const mandate = this.repos.mandates.findActive();
    const spentThisMonthCents = this.repos.purchases.sumCapturedInUtcMonth(now);

    const pendingItems = this.repos.approvals
      .listWithPurchases()
      .filter((item) => item.approval.status === "pending");
    const pendingTotalCents = pendingItems.reduce(
      (sum, item) => sum + item.purchase.totalCents,
      0
    );

    const remainingThisMonthCents = mandate
      ? Math.max(0, subtractCents(mandate.monthlyCapCents, spentThisMonthCents))
      : 0;

    return {
      mandate,
      spentThisMonthCents,
      remainingThisMonthCents,
      pendingCount: pendingItems.length,
      pendingTotalCents,
      warnings: mandate ? getMandateWarnings(mandate) : [],
    };
  }

  private async parseWithSingleRetry(
    sourceText: string
  ): Promise<MandateParseOutput> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt++) {
      const userPrompt =
        attempt === 0
          ? sourceText
          : `${sourceText}\n\nPrevious output failed validation with error: ${
              lastError instanceof Error ? lastError.message : String(lastError)
            }. Please fix the JSON to satisfy all constraints.`;

      try {
        return await this.llm.parseStructured({
          systemPrompt: MANDATE_PARSER_SYSTEM_PROMPT,
          userPrompt,
          schema: MandateParseOutputSchema,
        });
      } catch (err) {
        lastError = err;
        const canRetry =
          attempt === 0 &&
          err instanceof LlmError &&
          (err.code === "LLM_INVALID_OUTPUT" || err.retryable);
        if (!canRetry) {
          break;
        }
      }
    }

    throw new DomainError(
      "MANDATE_PARSE_FAILED",
      lastError instanceof Error
        ? `Could not parse mandate: ${lastError.message}`
        : "Could not parse mandate."
    );
  }
}
