"use client";

import React, { useState } from "react";
import { formatUsd, type ApprovalItemView } from "./types";

export interface ApprovalInboxProps {
  approvals: ApprovalItemView[];
  isSimulated: boolean;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onRetryOrder?: (purchaseId: string) => Promise<void>;
}

export function ApprovalInbox({
  approvals,
  isSimulated,
  onApprove,
  onReject,
  onRetryOrder,
}: ApprovalInboxProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pendingOrAwaitingPayPal = approvals.filter(
    (item) =>
      item.approval.status === "pending" ||
      (item.approval.status === "approved" &&
        item.purchase.status === "approved" &&
        Boolean(item.purchase.paypalApprovalUrl))
  );

  const history = approvals.filter(
    (item) =>
      item.approval.status !== "pending" &&
      !(
        item.approval.status === "approved" &&
        item.purchase.status === "approved" &&
        Boolean(item.purchase.paypalApprovalUrl)
      )
  );

  async function handleAction(id: string, fn: (id: string) => Promise<void>) {
    setError(null);
    setBusyId(id);
    try {
      await fn(id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not process approval."
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Approval Inbox</h2>
        <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
          {pendingOrAwaitingPayPal.length} action
          {pendingOrAwaitingPayPal.length === 1 ? "" : "s"} needed
        </span>
      </div>

      {error && (
        <div className="mt-2.5 rounded-md border border-rose-300 bg-rose-50 p-2.5 text-xs text-rose-900">
          {error}
        </div>
      )}

      <div className="mt-3 space-y-2.5">
        {pendingOrAwaitingPayPal.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500">
            No pending approvals. Items above your auto-approve threshold will
            appear here for confirmation.
          </div>
        ) : (
          pendingOrAwaitingPayPal.map(({ approval, purchase }) => {
            const isBusy = busyId === approval.id;
            const awaitingPayPal =
              approval.status === "approved" &&
              purchase.status === "approved" &&
              purchase.paypalApprovalUrl;

            return (
              <div
                key={approval.id}
                className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 text-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-900">
                      {purchase.title}
                    </p>
                    <p className="text-slate-600">
                      {purchase.merchant} · {purchase.category} · Qty{" "}
                      {purchase.quantity}
                    </p>
                  </div>
                  <span className="font-mono text-sm font-bold text-slate-900">
                    {formatUsd(purchase.totalCents)}
                  </span>
                </div>

                <p className="mt-1.5 text-amber-900">
                  <strong>Rule:</strong> {purchase.policyDecision.explanation}
                </p>

                {awaitingPayPal ? (
                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-md border border-blue-200 bg-blue-50 p-2">
                    <span className="font-medium text-blue-900">
                      Approved! Complete PayPal buyer step
                      {isSimulated ? " [SIMULATED]" : ""}:
                    </span>
                    <div className="flex items-center gap-2">
                      <a
                        href={purchase.paypalApprovalUrl!}
                        className="rounded-md bg-blue-600 px-3 py-1.5 font-semibold text-white shadow-xs hover:bg-blue-700"
                      >
                        Confirm payment on PayPal →
                      </a>
                      {onRetryOrder && (
                        <button
                          type="button"
                          onClick={() => onRetryOrder(purchase.id)}
                          className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-700 shadow-xs hover:bg-slate-50"
                        >
                          Try again
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="mt-2.5 flex gap-2">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleAction(approval.id, onApprove)}
                      className="flex-1 rounded-md bg-emerald-600 px-3 py-1.5 font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {isBusy ? "Working..." : "Approve"}
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleAction(approval.id, onReject)}
                      className="flex-1 rounded-md border border-rose-300 bg-white px-3 py-1.5 font-semibold text-rose-700 shadow-xs hover:bg-rose-50 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}

        {history.length > 0 && (
          <div className="border-t border-slate-200 pt-2.5">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Recent Decisions
            </p>
            <div className="space-y-1.5">
              {history.slice(0, 4).map(({ approval, purchase }) => (
                <div
                  key={approval.id}
                  className="flex items-center justify-between rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700"
                >
                  <span className="truncate font-medium">{purchase.title}</span>
                  <span
                    className={`ml-2 shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                      purchase.status === "captured"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-rose-100 text-rose-800"
                    }`}
                  >
                    {purchase.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

