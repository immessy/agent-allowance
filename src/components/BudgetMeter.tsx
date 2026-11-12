"use client";

import React from "react";
import { formatUsd } from "./types";

export interface BudgetMeterProps {
  monthlyCapCents: number;
  spentThisMonthCents: number;
  remainingThisMonthCents: number;
  pendingTotalCents: number;
}

export function BudgetMeter({
  monthlyCapCents,
  spentThisMonthCents,
  remainingThisMonthCents,
  pendingTotalCents,
}: BudgetMeterProps) {
  const cap = Math.max(1, monthlyCapCents);
  const spentPct = Math.min(100, Math.round((spentThisMonthCents / cap) * 100));
  const pendingPct = Math.min(
    100 - spentPct,
    Math.round((pendingTotalCents / cap) * 100)
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">
          Monthly Budget Meter (UTC)
        </h2>
        <span className="text-xs font-medium text-slate-500">
          Cap: {formatUsd(monthlyCapCents)}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-slate-50 p-2.5">
          <span className="block text-[11px] font-medium text-slate-500">
            Captured Spend
          </span>
          <span className="text-base font-bold text-slate-900">
            {formatUsd(spentThisMonthCents)}
          </span>
        </div>
        <div className="rounded-lg bg-amber-50/60 p-2.5">
          <span className="block text-[11px] font-medium text-amber-700">
            Pending Approval
          </span>
          <span className="text-base font-bold text-amber-800">
            {formatUsd(pendingTotalCents)}
          </span>
        </div>
        <div className="rounded-lg bg-emerald-50/60 p-2.5">
          <span className="block text-[11px] font-medium text-emerald-700">
            Remaining Budget
          </span>
          <span className="text-base font-bold text-emerald-800">
            {formatUsd(remainingThisMonthCents)}
          </span>
        </div>
      </div>

      <div className="mt-3">
        <div className="flex justify-between text-[11px] font-medium text-slate-500">
          <span>{spentPct}% utilized</span>
          <span>{100 - spentPct}% available</span>
        </div>
        <div className="mt-1 flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
          <div
            style={{ width: `${spentPct}%` }}
            className="bg-slate-900 transition-all duration-300"
            title={`Captured: ${spentPct}%`}
          />
          <div
            style={{ width: `${pendingPct}%` }}
            className="bg-amber-400 transition-all duration-300"
            title={`Pending: ${pendingPct}%`}
          />
        </div>
      </div>
    </section>
  );
}

