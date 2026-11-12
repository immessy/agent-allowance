export interface MandateView {
  id: string;
  status: "draft" | "active" | "archived";
  sourceText: string;
  monthlyCapCents: number;
  autoApproveLimitCents: number;
  hardLimitCents: number;
  allowedCategories: string[];
  blockedMerchants: string[];
  createdAt: string;
  activatedAt: string | null;
}

export interface MandateSummaryView {
  mandate: MandateView | null;
  spentThisMonthCents: number;
  remainingThisMonthCents: number;
  pendingCount: number;
  pendingTotalCents: number;
  warnings: string[];
}

export interface PolicyDecisionView {
  decision: "APPROVE" | "ASK_HUMAN" | "DENY";
  reasonCode: string;
  explanation: string;
  remainingBudgetCents: number;
}

export interface PurchaseView {
  id: string;
  productId: string;
  title: string;
  merchant: string;
  category: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  status:
    | "pending_approval"
    | "approved"
    | "captured"
    | "rejected"
    | "denied"
    | "failed";
  policyDecision: PolicyDecisionView;
  paypalOrderId: string | null;
  paypalApprovalUrl: string | null;
  createdAt: string;
  updatedAt: string;
  capturedAt: string | null;
}

export interface ApprovalItemView {
  approval: {
    id: string;
    purchaseId: string;
    status: "pending" | "approved" | "rejected";
    createdAt: string;
    decidedAt: string | null;
  };
  purchase: PurchaseView;
}

export interface AgentStepView {
  type: "search" | "budget" | "purchase" | "suspicious_flag";
  summary: string;
  payload?: Record<string, unknown>;
}

export interface ChatTurnResponseView {
  reply: string;
  iterations: number;
  reachedIterationCap: boolean;
  steps: AgentStepView[];
  decisions: PolicyDecisionView[];
  purchases: Array<{
    purchase: PurchaseView;
    decision: PolicyDecisionView;
    approvalId: string | null;
  }>;
}

export interface AuditEventView {
  id: string;
  timestamp: string;
  type: string;
  purchaseId: string | null;
  actor: string;
  summary: string;
  payload: Record<string, unknown>;
}

export interface HealthView {
  status: string;
  paypal: {
    env: string;
    configured: boolean;
    mode: string;
    paymentMode: "real" | "simulated";
    isSimulated: boolean;
  };
  llm: {
    mock: boolean;
    anthropicConfigured: boolean;
  };
  demoMode: boolean;
  activeMandate: boolean;
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

