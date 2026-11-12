"use client";

import React, { useState } from "react";
import { formatUsd, type MandateView } from "./types";

export interface MandatePanelProps {
  activeMandate: MandateView | null;
  onParse: (text: string) => Promise<{
    mandate: MandateView | null;
    clarifyingQuestion: string | null;
    warnings: string[];
  }>;
  onActivate: (draft: {
    sourceText: string;
    monthlyCapCents: number;
    autoApproveLimitCents: number;
    hardLimitCents: number;
    allowedCategories: string[];
    blockedMerchants: string[];
  }) => Promise<void>;
}

const SAMPLE_MANDATE =
  "Spend up to $150/month on running gear and nutrition. Auto-approve purchases up to $50. Never spend over $120 on a single purchase, and never buy from ShadyDeals.";

export function MandatePanel({
  activeMandate,
  onParse,
  onActivate,
}: MandatePanelProps) {
  const [text, setText] = useState(activeMandate?.sourceText ?? SAMPLE_MANDATE);
  const [isParsing, setIsParsing] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clarifyingQuestion, setClarifyingQuestion] = useState<string | null>(
    null
  );
  const [warnings, setWarnings] = useState<string[]>([]);

  // Draft preview fields (dollars in form for user friendliness)
  const [draft, setDraft] = useState<{
    sourceText: string;
    monthlyCapUsd: string;
    autoApproveUsd: string;
    hardLimitUsd: string;
    categories: string;
    blocked: string;
  } | null>(null);

  async function handleParse(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || isParsing) return;
    setError(null);
    setClarifyingQuestion(null);
    setIsParsing(true);
    try {
      const res = await onParse(text.trim());
      if (res.clarifyingQuestion) {
        setClarifyingQuestion(res.clarifyingQuestion);
        setDraft(null);
        setWarnings([]);
      } else if (res.mandate) {
        setDraft({
          sourceText: res.mandate.sourceText,
          monthlyCapUsd: (res.mandate.monthlyCapCents / 100).toFixed(2),
          autoApproveUsd: (res.mandate.autoApproveLimitCents / 100).toFixed(2),
          hardLimitUsd: (res.mandate.hardLimitCents / 100).toFixed(2),
          categories: res.mandate.allowedCategories.join(", "),
          blocked: res.mandate.blockedMerchants.join(", "),
        });
        setWarnings(res.warnings);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse mandate.");
    } finally {
      setIsParsing(false);
    }
  }

  async function handleActivate() {
    if (!draft || isActivating) return;
    setError(null);

    const monthlyCapCents = Math.round(Number.parseFloat(draft.monthlyCapUsd) * 100);
    const autoApproveLimitCents = Math.round(
      Number.parseFloat(draft.autoApproveUsd) * 100
    );
    const hardLimitCents = Math.round(Number.parseFloat(draft.hardLimitUsd) * 100);
    const allowedCategories = draft.categories
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const blockedMerchants = draft.blocked
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (
      !Number.isFinite(monthlyCapCents) ||
      !Number.isFinite(autoApproveLimitCents) ||
      !Number.isFinite(hardLimitCents) ||
      allowedCategories.length === 0
    ) {
      setError("Please verify all USD limits and provide at least one category.");
      return;
    }

    setIsActivating(true);
    try {
      await onActivate({
        sourceText: draft.sourceText,
        monthlyCapCents,
        autoApproveLimitCents,
        hardLimitCents,
        allowedCategories,
        blockedMerchants,
      });
      setDraft(null);
      setWarnings([]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to activate mandate."
      );
    } finally {
      setIsActivating(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">
          Spending Mandate
        </h2>
        {activeMandate && (
          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
            Active
          </span>
        )}
      </div>

      {activeMandate && !draft && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          <div className="grid grid-cols-3 gap-2 font-medium">
            <div>
              <span className="block text-[10px] uppercase text-slate-500">
                Monthly Cap
              </span>
              <span className="text-sm font-bold text-slate-900">
                {formatUsd(activeMandate.monthlyCapCents)}
              </span>
            </div>
            <div>
              <span className="block text-[10px] uppercase text-slate-500">
                Auto-Approve
              </span>
              <span className="text-sm font-bold text-emerald-700">
                {formatUsd(activeMandate.autoApproveLimitCents)}
              </span>
            </div>
            <div>
              <span className="block text-[10px] uppercase text-slate-500">
                Hard Limit
              </span>
              <span className="text-sm font-bold text-rose-700">
                {formatUsd(activeMandate.hardLimitCents)}
              </span>
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-slate-200/80 pt-2">
            <span className="text-slate-500">Allowed:</span>
            {activeMandate.allowedCategories.map((cat) => (
              <span
                key={cat}
                className="rounded-sm bg-white px-1.5 py-0.5 font-medium text-slate-800 ring-1 ring-slate-200"
              >
                {cat}
              </span>
            ))}
          </div>
          {activeMandate.blockedMerchants.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <span className="text-slate-500">Blocked:</span>
              {activeMandate.blockedMerchants.map((m) => (
                <span
                  key={m}
                  className="rounded-sm bg-rose-50 px-1.5 py-0.5 font-medium text-rose-800 ring-1 ring-rose-200"
                >
                  {m}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleParse} className="mt-3 space-y-2">
        <label
          htmlFor="mandate-input"
          className="block text-xs font-medium text-slate-600"
        >
          Update rules in plain English:
        </label>
        <textarea
          id="mandate-input"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20"
          placeholder="Spend up to $150/month..."
        />
        <button
          type="submit"
          disabled={isParsing || !text.trim()}
          className="w-full rounded-lg border border-slate-300 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 disabled:opacity-50"
        >
          {isParsing ? "Parsing Rules..." : "Parse Mandate"}
        </button>
      </form>

      {error && (
        <div className="mt-2.5 rounded-md border border-rose-300 bg-rose-50 p-2.5 text-xs text-rose-900">
          {error}
        </div>
      )}

      {clarifyingQuestion && (
        <div className="mt-2.5 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
          <strong>Clarification needed:</strong> {clarifyingQuestion}
        </div>
      )}

      {draft && (
        <div className="mt-3 space-y-2.5 rounded-lg border border-emerald-300 bg-emerald-50/40 p-3 text-xs">
          <div className="flex items-center justify-between">
            <strong className="text-emerald-900">Draft Rule Preview</strong>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="text-slate-500 hover:text-slate-700"
            >
              Cancel
            </button>
          </div>

          {warnings.length > 0 && (
            <ul className="space-y-1 rounded-sm bg-amber-50 p-2 text-amber-900">
              {warnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          )}

          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="text-[10px] font-medium text-slate-600">
                Cap ($)
              </span>
              <input
                type="number"
                step="0.01"
                value={draft.monthlyCapUsd}
                onChange={(e) =>
                  setDraft({ ...draft, monthlyCapUsd: e.target.value })
                }
                className="mt-0.5 w-full rounded-sm border border-slate-300 bg-white px-2 py-1 text-xs"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-medium text-slate-600">
                Auto ($)
              </span>
              <input
                type="number"
                step="0.01"
                value={draft.autoApproveUsd}
                onChange={(e) =>
                  setDraft({ ...draft, autoApproveUsd: e.target.value })
                }
                className="mt-0.5 w-full rounded-sm border border-slate-300 bg-white px-2 py-1 text-xs"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-medium text-slate-600">
                Hard ($)
              </span>
              <input
                type="number"
                step="0.01"
                value={draft.hardLimitUsd}
                onChange={(e) =>
                  setDraft({ ...draft, hardLimitUsd: e.target.value })
                }
                className="mt-0.5 w-full rounded-sm border border-slate-300 bg-white px-2 py-1 text-xs"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-[10px] font-medium text-slate-600">
              Allowed Categories (comma-separated)
            </span>
            <input
              type="text"
              value={draft.categories}
              onChange={(e) =>
                setDraft({ ...draft, categories: e.target.value })
              }
              className="mt-0.5 w-full rounded-sm border border-slate-300 bg-white px-2 py-1 text-xs"
            />
          </label>

          <label className="block">
            <span className="text-[10px] font-medium text-slate-600">
              Blocked Merchants (comma-separated)
            </span>
            <input
              type="text"
              value={draft.blocked}
              onChange={(e) => setDraft({ ...draft, blocked: e.target.value })}
              className="mt-0.5 w-full rounded-sm border border-slate-300 bg-white px-2 py-1 text-xs"
            />
          </label>

          <button
            type="button"
            onClick={handleActivate}
            disabled={isActivating}
            className="w-full rounded-md bg-emerald-600 px-3 py-1.5 font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50"
          >
            {isActivating ? "Activating..." : "Activate Mandate"}
          </button>
        </div>
      )}
    </section>
  );
}

