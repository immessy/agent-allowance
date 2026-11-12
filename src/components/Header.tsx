"use client";

import React from "react";

export interface HeaderProps {
  paypalEnv: string;
  paymentMode: "real" | "simulated";
  isMockLlm: boolean;
  isResetting: boolean;
  onReset: () => Promise<void>;
}

export function Header({
  paypalEnv,
  paymentMode,
  isMockLlm,
  isResetting,
  onReset,
}: HeaderProps) {
  return (
    <header className="border-b border-slate-200 bg-white shadow-xs">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 font-bold text-white shadow-xs">
            AA
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">Agent Allowance</h1>
            <p className="text-xs text-slate-500">
              Deterministic spending guardrails for AI shopping agents
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
            PayPal {paypalEnv.toUpperCase()}
          </span>

          {paymentMode === "simulated" ? (
            <span
              data-testid="simulated-badge"
              className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-900 ring-1 ring-amber-400"
            >
              SIMULATED PAYPAL
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800">
              LIVE MODE B
            </span>
          )}

          <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
            LLM: {isMockLlm ? "Mock / Scripted" : "Anthropic Claude"}
          </span>

          <button
            type="button"
            onClick={onReset}
            disabled={isResetting}
            className="ml-2 inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-xs hover:bg-slate-50 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
          >
            {isResetting ? "Resetting..." : "Reset Demo"}
          </button>
        </div>
      </div>
    </header>
  );
}

