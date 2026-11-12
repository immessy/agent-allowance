import type { ToolTurnInput, ToolTurnOutput } from "@/services/llm-client";

export const DEMO_MANDATE_TEXT =
  "Spend up to $150/month on running gear and nutrition. Auto-approve purchases up to $50. Never spend over $120 on a single purchase, and never buy from ShadyDeals.";

export const DEMO_MANDATE_STRUCTURED = {
  draft: {
    sourceText: DEMO_MANDATE_TEXT,
    monthlyCapCents: 15000,
    autoApproveLimitCents: 5000,
    hardLimitCents: 12000,
    allowedCategories: ["running gear", "nutrition"],
    blockedMerchants: ["ShadyDeals"],
  },
  clarifyingQuestion: null,
};

export function handleScenarioStructuredParse(userPrompt: string): unknown {
  const lower = userPrompt.toLowerCase();
  if (!lower.includes("$") && !lower.includes("month") && !lower.includes("cap")) {
    return {
      draft: null,
      clarifyingQuestion:
        "What monthly spending cap and allowed categories would you like to set?",
    };
  }
  return {
    draft: {
      sourceText: userPrompt,
      monthlyCapCents: 15000,
      autoApproveLimitCents: 5000,
      hardLimitCents: 12000,
      allowedCategories: ["running gear", "nutrition"],
      blockedMerchants: ["ShadyDeals"],
    },
    clarifyingQuestion: null,
  };
}

function toolTurn(id: string, name: string, input: Record<string, unknown>): ToolTurnOutput {
  return {
    stopReason: "tool_use",
    text: "",
    toolCalls: [{ id, name, input }],
    assistantBlocks: [{ type: "tool_use", id, name, input }],
  };
}

function endTurn(text: string): ToolTurnOutput {
  return {
    stopReason: "end_turn",
    text,
    toolCalls: [],
    assistantBlocks: [{ type: "text", text }],
  };
}

/**
 * Deterministic fixture handler for the five PRD section 10 scenarios.
 */
export function handleScenarioToolTurn(input: ToolTurnInput): ToolTurnOutput {
  const userText = input.messages
    .filter((m) => m.role === "user" && typeof m.content === "string")
    .map((m) => m.content as string)
    .join(" ")
    .toLowerCase();

  const toolResults = input.messages.flatMap((m) =>
    Array.isArray(m.content)
      ? m.content.filter((c) => c.type === "tool_result")
      : []
  );

  // Scenario 1: Energy gels ($24, auto-approved)
  if (userText.includes("gel")) {
    if (toolResults.length === 0) {
      return toolTurn("tc-s1-1", "search_products", { query: "energy gels" });
    }
    if (toolResults.length === 1) {
      return toolTurn("tc-s1-2", "request_purchase", {
        productId: "prod-gels-24",
        quantity: 1,
      });
    }
    return endTurn(
      "Purchased TrailFuel Energy Gels for $24.00. The purchase was automatically approved because it is within your $50.00 auto-approve limit."
    );
  }

  // Scenario 2: Trail running shoes ($89, needs approval)
  if (userText.includes("shoe")) {
    if (toolResults.length === 0) {
      return toolTurn("tc-s2-1", "search_products", { query: "trail running shoes" });
    }
    if (toolResults.length === 1) {
      return toolTurn("tc-s2-2", "request_purchase", {
        productId: "prod-shoes-89",
        quantity: 1,
      });
    }
    return endTurn(
      "Found Apex Trail Running Shoes for $89.00. This exceeds your $50.00 auto-approve limit, so I have submitted an approval request for you in your inbox."
    );
  }

  // Scenario 3: GPS sports watch ($249, denied out of category + over hard limit)
  if (userText.includes("watch")) {
    if (toolResults.length === 0) {
      return toolTurn("tc-s3-1", "search_products", { query: "GPS sports watch" });
    }
    if (toolResults.length === 1) {
      return toolTurn("tc-s3-2", "request_purchase", {
        productId: "prod-watch-249",
        quantity: 1,
      });
    }
    return endTurn(
      "Purchase denied: Garmin Forerunner Watch is $249.00. The electronics category is not permitted by your mandate, and $249.00 exceeds your $120.00 single-item limit."
    );
  }

  // Scenario 4: Cheapest headlamp ($58 injection bait, needs approval)
  if (userText.includes("headlamp")) {
    if (toolResults.length === 0) {
      return toolTurn("tc-s4-1", "search_products", { query: "headlamp" });
    }
    if (toolResults.length === 1) {
      return toolTurn("tc-s4-2", "request_purchase", {
        productId: "prod-headlamp-injection",
        quantity: 1,
      });
    }
    return endTurn(
      "Found NightTrail Ultra Headlamp for $58.00. Because $58.00 is above your $50.00 auto-approve limit, I have requested your approval in the inbox."
    );
  }

  // Scenario 5: Hydration vest ($45, denied over monthly budget)
  if (userText.includes("vest") || userText.includes("hydration")) {
    if (toolResults.length === 0) {
      return toolTurn("tc-s5-1", "search_products", { query: "hydration vest" });
    }
    if (toolResults.length === 1) {
      return toolTurn("tc-s5-2", "request_purchase", {
        productId: "prod-vest-45",
        quantity: 1,
      });
    }
    return endTurn(
      "Purchase denied: SwiftHydro Vest is $45.00, which exceeds your remaining monthly budget."
    );
  }

  // General fallback: budget check or quick search
  if (toolResults.length === 0) {
    return toolTurn("tc-gen-1", "get_budget", {});
  }
  return endTurn("I checked your current budget status.");
}
