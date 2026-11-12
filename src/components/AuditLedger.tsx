"use client";

import React, { useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  type ColDef,
  type ICellRendererParams,
} from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import type { AuditEventView } from "./types";

ModuleRegistry.registerModules([AllCommunityModule]);

export interface AuditLedgerProps {
  events: AuditEventView[];
  isSimulated: boolean;
  onRefresh?: () => void;
}

interface LedgerRow {
  id: string;
  timestamp: string;
  type: string;
  actor: string;
  summary: string;
  amountUsd: string;
  orderId: string;
  simulated: boolean;
}

function EventBadgeRenderer(params: ICellRendererParams<LedgerRow>) {
  const type = params.value as string;
  let color = "bg-slate-100 text-slate-800";
  if (type === "PAYPAL_CAPTURED" || type === "APPROVAL_GRANTED") {
    color = "bg-emerald-100 text-emerald-800 font-semibold";
  } else if (
    type === "APPROVAL_REQUESTED" ||
    type === "PAYPAL_ORDER_CREATED"
  ) {
    color = "bg-amber-100 text-amber-800";
  } else if (
    type === "APPROVAL_REJECTED" ||
    type === "PAYPAL_FAILED" ||
    type === "SUSPICIOUS_CONTENT_FLAGGED"
  ) {
    color = "bg-rose-100 text-rose-800 font-semibold";
  } else if (type === "POLICY_DECISION") {
    color = "bg-blue-100 text-blue-800";
  }

  return (
    <div className="flex items-center gap-1.5 py-1">
      <span className={`rounded-sm px-1.5 py-0.5 text-[11px] ${color}`}>
        {type}
      </span>
      {params.data?.simulated && (
        <span className="rounded-xs bg-amber-200 px-1 py-0.2 text-[9px] font-bold text-amber-900">
          SIMULATED
        </span>
      )}
    </div>
  );
}

export function AuditLedger({
  events,
  isSimulated,
  onRefresh,
}: AuditLedgerProps) {
  const [quickFilter, setQuickFilter] = useState("");

  const rowData: LedgerRow[] = useMemo(() => {
    return events.map((evt) => {
      const payload = evt.payload ?? {};
      const amountCents =
        typeof payload.amountCents === "number"
          ? payload.amountCents
          : typeof payload.totalCents === "number"
          ? payload.totalCents
          : null;

      const orderId =
        typeof payload.orderId === "string"
          ? payload.orderId
          : typeof payload.paypalOrderId === "string"
          ? payload.paypalOrderId
          : "-";

      const eventIsSimulated =
        Boolean(payload.simulated) ||
        isSimulated ||
        orderId.startsWith("SIM-") ||
        orderId.startsWith("FAKE-");

      return {
        id: evt.id,
        timestamp: new Date(evt.timestamp).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        type: evt.type,
        actor: evt.actor,
        summary: evt.summary,
        amountUsd: amountCents !== null ? `$${(amountCents / 100).toFixed(2)}` : "-",
        orderId,
        simulated: eventIsSimulated,
      };
    });
  }, [events, isSimulated]);

  const columnDefs: ColDef<LedgerRow>[] = useMemo(
    () => [
      {
        field: "timestamp",
        headerName: "Time",
        width: 100,
        sortable: true,
      },
      {
        field: "type",
        headerName: "Event Type",
        width: 190,
        sortable: true,
        filter: true,
        cellRenderer: EventBadgeRenderer,
      },
      {
        field: "actor",
        headerName: "Actor",
        width: 90,
        sortable: true,
      },
      {
        field: "amountUsd",
        headerName: "Amount",
        width: 95,
        sortable: true,
      },
      {
        field: "summary",
        headerName: "Summary & Explanation",
        flex: 1,
        minWidth: 260,
        sortable: true,
      },
      {
        field: "orderId",
        headerName: "PayPal Order ID",
        width: 160,
        sortable: true,
      },
    ],
    []
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Immutable Audit Ledger
          </h2>
          <p className="text-xs text-slate-500">
            Append-only record of every policy evaluation, human approval, and
            PayPal event.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="search"
            value={quickFilter}
            onChange={(e) => setQuickFilter(e.target.value)}
            placeholder="Quick search events..."
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-hidden"
          />
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Refresh
            </button>
          )}
        </div>
      </div>

      <div className="ag-theme-quartz mt-3 h-[380px] w-full text-xs">
        <AgGridReact
          rowData={rowData}
          columnDefs={columnDefs}
          quickFilterText={quickFilter}
          animateRows
          pagination
          paginationPageSize={10}
        />
      </div>
    </section>
  );
}

