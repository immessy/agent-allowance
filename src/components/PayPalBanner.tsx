"use client";

import React from "react";

export interface PayPalBannerProps {
  paypalStatus: string | null;
  orderId: string | null;
  errorMessage: string | null;
  onDismiss: () => void;
}

export function PayPalBanner({
  paypalStatus,
  orderId,
  errorMessage,
  onDismiss,
}: PayPalBannerProps) {
  if (!paypalStatus) {
    return null;
  }

  if (paypalStatus === "success") {
    return (
      <div
        role="alert"
        className="mx-auto mt-4 flex max-w-7xl items-center justify-between rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-xs"
      >
        <div>
          <strong className="font-semibold">Payment captured!</strong> Order{" "}
          <code className="rounded-xs bg-emerald-100 px-1.5 py-0.5 font-mono text-xs">
            {orderId ?? "unknown"}
          </code>{" "}
          has been captured via PayPal and recorded in the audit ledger.
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="ml-4 rounded-md px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (paypalStatus === "cancelled") {
    return (
      <div
        role="alert"
        className="mx-auto mt-4 flex max-w-7xl items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-xs"
      >
        <div>
          <strong className="font-semibold">Checkout cancelled.</strong> Buyer
          cancelled PayPal checkout{" "}
          {orderId && (
            <span>
              for order{" "}
              <code className="rounded-xs bg-amber-100 px-1.5 py-0.5 font-mono text-xs">
                {orderId}
              </code>
            </span>
          )}
          . No funds were captured.
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="ml-4 rounded-md px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
        >
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="mx-auto mt-4 flex max-w-7xl items-center justify-between rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900 shadow-xs"
    >
      <div>
        <strong className="font-semibold">PayPal capture error:</strong>{" "}
        {errorMessage ?? "Could not complete order capture."}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-4 rounded-md px-2 py-1 text-xs font-medium text-rose-800 hover:bg-rose-100"
      >
        Dismiss
      </button>
    </div>
  );
}

