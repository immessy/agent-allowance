import fs from "node:fs";
import path from "node:path";
import { createDatabase, type AppDatabase } from "@/infra/db/client";
import { createRepositories, type Repositories } from "@/infra/db/repositories";
import { AnthropicLlmClient } from "@/infra/llm/anthropic";
import {
  handleScenarioStructuredParse,
  handleScenarioToolTurn,
} from "@/infra/llm/fixtures";
import { ScriptedLlmClient } from "@/infra/llm/scripted";
import { FakePaymentExecutor } from "@/infra/paypal/fake-executor";
import { PayPalPaymentExecutor } from "@/infra/paypal/executor";
import { LocalProductProvider, type ProductProvider } from "@/infra/products";
import { AgentService } from "@/services/agent";
import { ApprovalService } from "@/services/approvals";
import { AuditService } from "@/services/audit";
import { resetDemo, seedDemoIfNeeded } from "@/services/demo";
import type { LlmClient } from "@/services/llm-client";
import { MandateService } from "@/services/mandate";
import { PurchaseOrchestrator } from "@/services/orchestrator";
import type { PaymentExecutor } from "@/services/payment-executor";

export interface AppContainer {
  db: AppDatabase;
  repos: Repositories;
  audit: AuditService;
  products: ProductProvider;
  executor: PaymentExecutor;
  orchestrator: PurchaseOrchestrator;
  approvals: ApprovalService;
  mandates: MandateService;
  agent: AgentService;
  llm: LlmClient;
  config: {
    appBaseUrl: string;
    paypalEnv: string;
    isDemoMode: boolean;
    isMockLlm: boolean;
    hasAnthropicKey: boolean;
    hasPayPalCredentials: boolean;
    paymentMode: "real" | "simulated";
    isSimulated: boolean;
  };
  nowFn: () => Date;
  resetDemoData: () => { success: boolean; durationMs: number };
}

let containerInstance: AppContainer | null = null;

/**
 * Startup sanity guard: PayPal environment MUST be sandbox in this application.
 */
function assertPayPalSandbox(envVal: string | undefined): void {
  const env = (envVal ?? "sandbox").trim().toLowerCase();
  if (env !== "sandbox") {
    throw new Error(
      `FATAL: PAYPAL_ENV is "${env}". Agent Allowance strictly enforces PAYPAL_ENV=sandbox to prevent unintended live transactions.`
    );
  }
}

export function createContainer(overrides?: {
  dbPath?: string;
  nowFn?: () => Date;
  mockLlm?: boolean;
  useFakeExecutor?: boolean;
  fakeMode?: "auto-capture" | "redirect";
  demoMode?: boolean;
}): AppContainer {
  const nowFn = overrides?.nowFn ?? (() => new Date());
  const paypalEnv = (process.env.PAYPAL_ENV ?? "sandbox").trim().toLowerCase();
  assertPayPalSandbox(paypalEnv);

  const clientId = process.env.PAYPAL_CLIENT_ID ?? "";
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET ?? "";
  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? "";
  const anthropicModel = process.env.ANTHROPIC_MODEL ?? "claude-haiku-5-5";
  const appBaseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const isDemoMode = overrides?.demoMode ?? process.env.DEMO_MODE !== "0";

  const isMockLlm =
    overrides?.mockLlm !== undefined
      ? overrides.mockLlm
      : process.env.MOCK_LLM === "1" || !anthropicKey.trim();

  const dbPath =
    overrides?.dbPath ?? process.env.DATABASE_PATH ?? "./data/agent-allowance.db";

  if (dbPath !== ":memory:") {
    const dir = path.dirname(path.resolve(dbPath));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = createDatabase(dbPath);
  db.migrate();
  const repos = createRepositories(db);
  const audit = new AuditService(repos.audit, nowFn);
  const products = new LocalProductProvider();

  const isSimulated =
    overrides?.useFakeExecutor !== undefined
      ? overrides.useFakeExecutor
      : process.env.PAYMENT_MODE === "simulated";

  if (!isSimulated && (!clientId.trim() || !clientSecret.trim())) {
    throw new Error(
      "PayPal credentials (PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET) are missing. Real mode is the default when running outside test harnesses. To run with simulated payments instead, explicitly set PAYMENT_MODE=simulated."
    );
  }

  const fakeMode =
    overrides?.fakeMode ??
    (process.env.FAKE_PAYPAL_MODE === "redirect" ? "redirect" : "auto-capture");

  const executor: PaymentExecutor = isSimulated
    ? new FakePaymentExecutor({ mode: fakeMode })
    : new PayPalPaymentExecutor({
        env: "sandbox",
        clientId,
        clientSecret,
      });

  const orchestrator = new PurchaseOrchestrator(
    db,
    repos,
    audit,
    products,
    executor,
    { appBaseUrl, nowFn }
  );

  const approvals = new ApprovalService(db, repos, audit, executor, {
    appBaseUrl,
    nowFn,
  });

  const llm: LlmClient = isMockLlm
    ? new ScriptedLlmClient({
        structuredHandler: handleScenarioStructuredParse,
        toolTurnHandler: handleScenarioToolTurn,
      })
    : new AnthropicLlmClient({
        apiKey: anthropicKey,
        model: anthropicModel,
      });

  const mandates = new MandateService(db, repos, audit, llm, nowFn);
  const agent = new AgentService(repos, audit, products, orchestrator, llm, nowFn);

  seedDemoIfNeeded(repos, mandates, isDemoMode);

  const resetDemoData = () =>
    resetDemo({ db, mandates, audit, isDemoMode });

  return {
    db,
    repos,
    audit,
    products,
    executor,
    orchestrator,
    approvals,
    mandates,
    agent,
    llm,
    config: {
      appBaseUrl,
      paypalEnv,
      isDemoMode,
      isMockLlm,
      hasAnthropicKey: Boolean(anthropicKey.trim()),
      hasPayPalCredentials: Boolean(clientId.trim() && clientSecret.trim()),
      paymentMode: isSimulated ? "simulated" : "real",
      isSimulated,
    },
    nowFn,
    resetDemoData,
  };
}

export function getContainer(): AppContainer {
  if (!containerInstance) {
    containerInstance = createContainer();
  }
  return containerInstance;
}

export function setContainerForTesting(container: AppContainer | null): void {
  containerInstance = container;
}
