"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AgentChat, type ChatMessage } from "@/components/AgentChat";
import { ApprovalInbox } from "@/components/ApprovalInbox";
import { AuditLedger } from "@/components/AuditLedger";
import { BudgetMeter } from "@/components/BudgetMeter";
import { Header } from "@/components/Header";
import { MandatePanel } from "@/components/MandatePanel";
import { PayPalBanner } from "@/components/PayPalBanner";
import type {
  ApprovalItemView,
  AuditEventView,
  ChatTurnResponseView,
  HealthView,
  MandateSummaryView,
  MandateView,
} from "@/components/types";

function DashboardContent() {
  const searchParams = useSearchParams();
  const paypalParam = searchParams.get("paypal");
  const orderIdParam = searchParams.get("orderId");
  const messageParam = searchParams.get("message");

  const [paypalBanner, setPaypalBanner] = useState<{
    status: string | null;
    orderId: string | null;
    message: string | null;
  }>({
    status: paypalParam,
    orderId: orderIdParam,
    message: messageParam,
  });

  const [health, setHealth] = useState<HealthView | null>(null);
  const [mandateSummary, setMandateSummary] =
    useState<MandateSummaryView | null>(null);
  const [approvals, setApprovals] = useState<ApprovalItemView[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEventView[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  const refreshState = useCallback(async () => {
    try {
      const [hRes, mRes, aRes, auRes] = await Promise.all([
        fetch("/api/health"),
        fetch("/api/mandate"),
        fetch("/api/approvals"),
        fetch("/api/audit?limit=250"),
      ]);

      if (hRes.ok) setHealth(await hRes.json());
      if (mRes.ok) setMandateSummary(await mRes.json());
      if (aRes.ok) {
        const data = await aRes.json();
        setApprovals(data.approvals ?? []);
      }
      if (auRes.ok) {
        const data = await auRes.json();
        setAuditEvents(data.events ?? []);
      }
    } catch (err) {
      console.error("Failed to load dashboard state:", err);
    } finally {
      setInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  // Handle return banner update on URL param change
  useEffect(() => {
    if (paypalParam) {
      setPaypalBanner({
        status: paypalParam,
        orderId: orderIdParam,
        message: messageParam,
      });
      void refreshState();
    }
  }, [paypalParam, orderIdParam, messageParam, refreshState]);

  const handleSendMessage = async (text: string) => {
    const userMsgId = `user-${Date.now()}`;
    const userMsg: ChatMessage = {
      id: userMsgId,
      role: "user",
      text,
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setIsSending(true);

    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      const data: ChatTurnResponseView & { code?: string; message?: string } =
        await res.json();

      if (!res.ok) {
        setChatMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            text: data.message ?? "Failed to process chat request.",
            error: data.code ?? "CHAT_ERROR",
          },
        ]);
      } else {
        setChatMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            text: data.reply,
            steps: data.steps,
            decisions: data.decisions,
            purchases: data.purchases,
          },
        ]);
      }
    } catch (err) {
      setChatMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          text:
            err instanceof Error ? err.message : "Network failure in chat.",
          error: "NETWORK_ERROR",
        },
      ]);
    } finally {
      setIsSending(false);
      void refreshState();
    }
  };

  const handleParseMandate = async (rawText: string) => {
    const res = await fetch("/api/mandate/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: rawText }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message ?? "Failed to parse mandate.");
    }
    return data as {
      mandate: MandateView | null;
      clarifyingQuestion: string | null;
      warnings: string[];
    };
  };

  const handleActivateMandate = async (draft: {
    sourceText: string;
    monthlyCapCents: number;
    autoApproveLimitCents: number;
    hardLimitCents: number;
    allowedCategories: string[];
    blockedMerchants: string[];
  }) => {
    const res = await fetch("/api/mandate/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message ?? "Failed to activate mandate.");
    }
    await refreshState();
  };

  const handleApprove = async (approvalId: string) => {
    const res = await fetch(`/api/approvals/${approvalId}/approve`, {
      method: "POST",
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message ?? "Approval failed.");
    }
    await refreshState();
  };

  const handleReject = async (approvalId: string) => {
    const res = await fetch(`/api/approvals/${approvalId}/reject`, {
      method: "POST",
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message ?? "Rejection failed.");
    }
    await refreshState();
  };

  const handleResetDemo = async () => {
    setIsResetting(true);
    try {
      const res = await fetch("/api/demo/reset", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Reset failed.");
      }
      setChatMessages([]);
      setPaypalBanner({ status: null, orderId: null, message: null });
      await refreshState();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Reset failed.");
    } finally {
      setIsResetting(false);
    }
  };

  const isSimulated = health?.paypal.isSimulated ?? false;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Header
        paypalEnv={health?.paypal.env ?? "sandbox"}
        paymentMode={health?.paypal.paymentMode ?? "real"}
        isMockLlm={health?.llm.mock ?? false}
        isResetting={isResetting}
        onReset={handleResetDemo}
      />

      <PayPalBanner
        paypalStatus={paypalBanner.status}
        orderId={paypalBanner.orderId}
        errorMessage={paypalBanner.message}
        onDismiss={() =>
          setPaypalBanner({ status: null, orderId: null, message: null })
        }
      />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {initialLoading ? (
          <div className="flex h-64 items-center justify-center text-sm text-slate-500">
            Initializing Agent Allowance...
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Left Column: Guardrails & Controls */}
            <div className="space-y-6 lg:col-span-5">
              <BudgetMeter
                monthlyCapCents={mandateSummary?.mandate?.monthlyCapCents ?? 0}
                spentThisMonthCents={mandateSummary?.spentThisMonthCents ?? 0}
                remainingThisMonthCents={
                  mandateSummary?.remainingThisMonthCents ?? 0
                }
                pendingTotalCents={mandateSummary?.pendingTotalCents ?? 0}
              />

              <MandatePanel
                activeMandate={mandateSummary?.mandate ?? null}
                onParse={handleParseMandate}
                onActivate={handleActivateMandate}
              />

              <ApprovalInbox
                approvals={approvals}
                isSimulated={isSimulated}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            </div>

            {/* Right Column: AI Agent Chat & Ledger */}
            <div className="space-y-6 lg:col-span-7">
              <AgentChat
                messages={chatMessages}
                isSending={isSending}
                isSimulated={isSimulated}
                onSendMessage={handleSendMessage}
              />

              <AuditLedger
                events={auditEvents}
                isSimulated={isSimulated}
                onRefresh={refreshState}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
          Loading Agent Allowance...
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
