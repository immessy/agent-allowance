import { describe, expect, it, vi } from "vitest";
import { MandateParseOutputSchema } from "@/domain/schemas";
import { ScriptedLlmClient } from "@/infra/llm/scripted";
import { AnthropicLlmClient } from "@/infra/llm/anthropic";
import { LlmError, type LlmClient } from "@/services/llm-client";

describe("LlmClient contract tests (T4.1)", () => {
  it("ScriptedLlmClient parses structured output and validates against Zod schema", async () => {
    const client: LlmClient = new ScriptedLlmClient({
      structuredResponses: [
        {
          draft: {
            sourceText: "Spend up to $150/month on nutrition.",
            monthlyCapCents: 15000,
            autoApproveLimitCents: 5000,
            hardLimitCents: 12000,
            allowedCategories: ["nutrition"],
            blockedMerchants: [],
          },
          clarifyingQuestion: null,
        },
      ],
    });

    const parsed = await client.parseStructured({
      systemPrompt: "Parse mandate",
      userPrompt: "Spend up to $150/month on nutrition.",
      schema: MandateParseOutputSchema,
    });

    expect(parsed.draft?.monthlyCapCents).toBe(15000);
    expect(parsed.clarifyingQuestion).toBeNull();
  });

  it("ScriptedLlmClient throws LlmError(LLM_INVALID_OUTPUT) when structured payload violates schema", async () => {
    const client = new ScriptedLlmClient({
      structuredResponses: [
        {
          draft: {
            sourceText: "Invalid",
            monthlyCapCents: 15000,
            autoApproveLimitCents: 10000,
            hardLimitCents: 5000, // hard < auto violates schema
            allowedCategories: ["nutrition"],
            blockedMerchants: [],
          },
          clarifyingQuestion: null,
        },
      ],
    });

    await expect(
      client.parseStructured({
        systemPrompt: "Parse",
        userPrompt: "Invalid",
        schema: MandateParseOutputSchema,
      })
    ).rejects.toMatchObject({
      name: "LlmError",
      code: "LLM_INVALID_OUTPUT",
    });
  });

  it("ScriptedLlmClient replays tool turns and end_turn responses", async () => {
    const client = new ScriptedLlmClient({
      toolTurns: [
        {
          stopReason: "tool_use",
          text: "",
          toolCalls: [
            { id: "tc-1", name: "search_products", input: { query: "gels" } },
          ],
          assistantBlocks: [
            {
              type: "tool_use",
              id: "tc-1",
              name: "search_products",
              input: { query: "gels" },
            },
          ],
        },
        {
          stopReason: "end_turn",
          text: "Bought energy gels for $24.",
          toolCalls: [],
          assistantBlocks: [
            { type: "text", text: "Bought energy gels for $24." },
          ],
        },
      ],
    });

    const first = await client.runToolTurn({
      systemPrompt: "You are a buyer agent.",
      messages: [{ role: "user", content: "Get energy gels" }],
      tools: [],
    });
    expect(first.stopReason).toBe("tool_use");
    expect(first.toolCalls[0]?.name).toBe("search_products");

    const second = await client.runToolTurn({
      systemPrompt: "You are a buyer agent.",
      messages: [
        { role: "user", content: "Get energy gels" },
        { role: "assistant", content: first.assistantBlocks },
        {
          role: "user",
          content: [{ type: "tool_result", toolUseId: "tc-1", content: "[]" }],
        },
      ],
      tools: [],
    });
    expect(second.stopReason).toBe("end_turn");
    expect(second.text).toContain("$24");
  });

  it("AnthropicLlmClient maps SDK calls and structured parsing", async () => {
    const parseMock = vi.fn().mockResolvedValue({
      parsed_output: {
        draft: null,
        clarifyingQuestion: "What is your monthly cap?",
      },
    });
    const createMock = vi.fn().mockResolvedValue({
      stop_reason: "tool_use",
      content: [
        { type: "text", text: "Searching..." },
        {
          type: "tool_use",
          id: "toolu_1",
          name: "get_budget",
          input: {},
        },
      ],
    });

    const client = new AnthropicLlmClient({
      apiKey: "test-key",
      model: "claude-haiku-5-5",
      sdkClient: {
        messages: {
          parse: parseMock,
          create: createMock,
        },
      } as never,
    });

    const structured = await client.parseStructured({
      systemPrompt: "sys",
      userPrompt: "spend some money",
      schema: MandateParseOutputSchema,
    });
    expect(structured.clarifyingQuestion).toBe("What is your monthly cap?");
    expect(parseMock).toHaveBeenCalledTimes(1);

    const turn = await client.runToolTurn({
      systemPrompt: "sys",
      messages: [{ role: "user", content: "budget?" }],
      tools: [
        {
          name: "get_budget",
          description: "Get remaining budget",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    });
    expect(turn.stopReason).toBe("tool_use");
    expect(turn.toolCalls).toEqual([
      { id: "toolu_1", name: "get_budget", input: {} },
    ]);
    expect(turn.text).toBe("Searching...");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("AnthropicLlmClient rejects empty apiKey or throws LlmError on transient errors", async () => {
    expect(() => new AnthropicLlmClient({ apiKey: "", model: "m" })).toThrow(
      LlmError
    );

    const createMock = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("Rate limit"), { status: 429 }));

    const client = new AnthropicLlmClient({
      apiKey: "test-key",
      model: "claude-haiku-5-5",
      sdkClient: {
        messages: {
          parse: vi.fn(),
          create: createMock,
        },
      } as never,
    });

    await expect(
      client.runToolTurn({
        systemPrompt: "sys",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
      })
    ).rejects.toMatchObject({
      name: "LlmError",
      code: "LLM_TRANSIENT",
      retryable: true,
    });
  });
});

