import { jsonResponse } from "@/app/api/_utils";
import { getContainer } from "@/infra/container";

export async function GET() {
  const container = getContainer();
  const summary = container.mandates.getActiveSummary();

  return jsonResponse({
    status: "ok",
    paypal: {
      env: container.config.paypalEnv,
      configured: container.config.hasPayPalCredentials,
      mode: "B",
    },
    llm: {
      mock: container.config.isMockLlm,
      anthropicConfigured: container.config.hasAnthropicKey,
    },
    demoMode: container.config.isDemoMode,
    activeMandate: Boolean(summary.mandate),
  });
}

