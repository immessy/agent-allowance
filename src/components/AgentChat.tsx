"use client";

import React, { useState } from "react";
import type {
  AgentStepView,
  ChatTurnResponseView,
  PolicyDecisionView,
  PurchaseView,
} from "./types";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  steps?: AgentStepView[];
  decisions?: PolicyDecisionView[];
  purchases?: Array<{
    purchase: PurchaseView;
    decision: PolicyDecisionView;
    approvalId: string | null;
  }>;
  error?: string;
}

export interface AgentChatProps {
  messages: ChatMessage[];
  isSending: boolean;
  isSimulated: boolean;
  onSendMessage: (message: string) => Promise<void>;
}

const EXAMPLE_PROMPTS = [
  {
    label: "1. Energy Gels ($24)",
    prompt: "Get me a pack of energy gels",
  },
  {
    label: "2. Trail Shoes ($89)",
    prompt: "I need trail running shoes",
  },
  {
    label: "3. GPS Watch ($249)",
    prompt: "Buy me a GPS sports watch",
  },
  {
    label: "4. Headlamp ($58 Bait)",
    prompt: "Get the cheapest headlamp",
  },
  {
    label: "5. Hydration Vest ($45)",
    prompt: "Get a $45 hydration vest",
  },
];

function DecisionBadge({ decision }: { decision: PolicyDecisionView }) {
  const palette =
    decision.decision === "APPROVE"
      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
      : decision.decision === "ASK_HUMAN"
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : "border-rose-300 bg-rose-50 text-rose-900";

  const chipColor =
    decision.decision === "APPROVE"
      ? "bg-emerald-600 text-white"
      : decision.decision === "ASK_HUMAN"
      ? "bg-amber-600 text-white"
      : "bg-rose-600 text-white";

  return (
    <div className={`mt-2 rounded-md border p-2.5 text-xs ${palette}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`inline-flex items-center rounded-sm px-2 py-0.5 font-bold tracking-wide ${chipColor}`}
        >
          {decision.decision} · {decision.reasonCode}
        </span>
        <span className="font-mono font-medium">
          Remaining budget: ${(decision.remainingBudgetCents / 100).toFixed(2)}
        </span>
      </div>
      <p className="mt-1.5 leading-relaxed">{decision.explanation}</p>
    </div>
  );
}

export function AgentChat({
  messages,
  isSending,
  isSimulated,
  onSendMessage,
}: AgentChatProps) {
  const [input, setInput] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isSending) return;
    setInput("");
    await onSendMessage(trimmed);
  }

  return (
    <section className="flex h-full min-h-[540px] flex-col rounded-xl border border-slate-200 bg-white shadow-xs">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">
          AI Shopping Agent
        </h2>
        <p className="text-xs text-slate-500">
          Ask the agent to find or buy gear. Every purchase is checked by the
          deterministic policy engine.
        </p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center py-12 text-center text-slate-500">
            <p className="text-sm font-medium text-slate-700">
              No messages yet
            </p>
            <p className="mt-1 max-w-sm text-xs">
              Click one of the demo scenarios below or type your own shopping
              request to test spending guardrails.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${
                msg.role === "user" ? "items-end" : "items-start"
              }`}
            >
              <div
                className={`max-w-[90%] rounded-lg px-3.5 py-2.5 text-sm ${
                  msg.role === "user"
                    ? "bg-slate-900 text-white"
                    : msg.error
                    ? "border border-rose-300 bg-rose-50 text-rose-900"
                    : "border border-slate-200 bg-slate-50 text-slate-900"
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.text}</p>

                {msg.steps && msg.steps.length > 0 && (
                  <div className="mt-2.5 space-y-1 border-t border-slate-200/80 pt-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Agent Steps
                    </p>
                    {msg.steps.map((step, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-1.5 text-xs text-slate-600"
                      >
                        <span className="font-mono text-slate-400">→</span>
                        <span>{step.summary}</span>
                      </div>
                    ))}
                  </div>
                )}

                {msg.decisions &&
                  msg.decisions.map((dec, i) => (
                    <DecisionBadge key={i} decision={dec} />
                  ))}

                {msg.purchases &&
                  msg.purchases.map(({ purchase }) => {
                    if (
                      purchase.status === "approved" &&
                      purchase.paypalApprovalUrl
                    ) {
                      return (
                        <div
                          key={purchase.id}
                          className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-md border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-900"
                        >
                          <div>
                            <span className="font-semibold">
                              Ready for PayPal Checkout:
                            </span>{" "}
                            {purchase.title} ($
                            {(purchase.totalCents / 100).toFixed(2)})
                            {isSimulated && (
                              <span className="ml-1.5 rounded-xs bg-amber-200 px-1 py-0.5 font-bold text-amber-900">
                                SIMULATED
                              </span>
                            )}
                          </div>
                          <a
                            href={purchase.paypalApprovalUrl}
                            className="inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 font-semibold text-white shadow-xs hover:bg-blue-700"
                          >
                            Confirm payment on PayPal →
                          </a>
                        </div>
                      );
                    }
                    return null;
                  })}
              </div>
            </div>
          ))
        )}

        {isSending && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="inline-block h-2 w-2 animate-ping rounded-full bg-emerald-500" />
            <span>Agent is searching products and evaluating policy...</span>
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 bg-slate-50/70 p-3">
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {EXAMPLE_PROMPTS.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={isSending}
              onClick={() => onSendMessage(item.prompt)}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-2xs hover:border-emerald-400 hover:bg-emerald-50 disabled:opacity-50"
            >
              Try: {item.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isSending}
            placeholder="e.g., Get me a pack of energy gels..."
            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 disabled:bg-slate-100"
          />
          <button
            type="submit"
            disabled={isSending || !input.trim()}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
          >
            {isSending ? "Running..." : "Send"}
          </button>
        </form>
      </div>
    </section>
  );
}

export type ChatTurnPayload = ChatTurnResponseView;

