import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlockParam,
  MessageParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages/messages";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import {
  LlmError,
  type LlmClient,
  type LlmContentBlock,
  type LlmMessage,
  type LlmToolCall,
  type StructuredParseInput,
  type ToolTurnInput,
  type ToolTurnOutput,
} from "@/services/llm-client";

export interface AnthropicSdkLike {
  messages: {
    parse: (
      params: Record<string, unknown>,
      options?: { signal?: AbortSignal }
    ) => Promise<{ parsed_output?: unknown }>;
    create: (
      params: Record<string, unknown>,
      options?: { signal?: AbortSignal }
    ) => Promise<{
      stop_reason?: string | null;
      content: Array<{
        type: string;
        text?: string;
        id?: string;
        name?: string;
        input?: unknown;
      }>;
    }>;
  };
}

export interface AnthropicLlmClientConfig {
  apiKey: string;
  model: string;
  defaultTimeoutMs?: number;
  sdkClient?: AnthropicSdkLike;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function toAnthropicMessages(messages: LlmMessage[]): MessageParam[] {
  return messages.map((msg) => {
    if (typeof msg.content === "string") {
      return { role: msg.role, content: msg.content };
    }
    const blocks: ContentBlockParam[] = msg.content.map((block) => {
      if (block.type === "text") {
        return { type: "text", text: block.text };
      }
      if (block.type === "tool_use") {
        return {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input,
        };
      }
      return {
        type: "tool_result",
        tool_use_id: block.toolUseId,
        content: block.content,
        is_error: block.isError,
      };
    });
    return { role: msg.role, content: blocks };
  });
}

function toAnthropicTools(tools: ToolTurnInput["tools"]): Tool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: "object",
      ...tool.inputSchema,
    },
  }));
}

function mapStopReason(
  reason: string | null | undefined
): ToolTurnOutput["stopReason"] {
  if (reason === "end_turn" || reason === "tool_use" || reason === "max_tokens") {
    return reason;
  }
  return "other";
}

function mapSdkError(err: unknown): LlmError {
  if (err instanceof LlmError) {
    return err;
  }
  if (err instanceof Error && err.name === "AbortError") {
    return new LlmError("LLM_TIMEOUT", "LLM request timed out.", true);
  }
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? (err as { status?: unknown }).status
      : undefined;

  if (status === 401 || status === 403) {
    return new LlmError("LLM_AUTH", "Anthropic authentication failed.", false);
  }
  if (
    status === 408 ||
    status === 429 ||
    (typeof status === "number" && status >= 500)
  ) {
    return new LlmError(
      "LLM_TRANSIENT",
      `Anthropic transient error (status ${String(status)}).`,
      true
    );
  }
  if (err instanceof Error && /timeout/i.test(err.message)) {
    return new LlmError("LLM_TIMEOUT", "LLM request timed out.", true);
  }
  if (err instanceof Error && /network|fetch|ECONN|ENOTFOUND/i.test(err.message)) {
    return new LlmError("LLM_TRANSIENT", "LLM network failure.", true);
  }
  return new LlmError(
    "LLM_FAILED",
    err instanceof Error ? err.message : "Unexpected LLM failure.",
    false
  );
}

/**
 * Anthropic Messages API implementation of LlmClient using zodOutputFormat and tools.
 */
export class AnthropicLlmClient implements LlmClient {
  private readonly sdk: AnthropicSdkLike;
  private readonly model: string;
  private readonly defaultTimeoutMs: number;

  constructor(config: AnthropicLlmClientConfig) {
    if (!config.apiKey.trim()) {
      throw new LlmError("LLM_AUTH", "ANTHROPIC_API_KEY is required.");
    }
    if (!config.model.trim()) {
      throw new LlmError("LLM_FAILED", "ANTHROPIC_MODEL is required.");
    }
    this.model = config.model.trim();
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.sdk =
      config.sdkClient ??
      (new Anthropic({ apiKey: config.apiKey }) as unknown as AnthropicSdkLike);
  }

  async parseStructured<T extends z.ZodType>(
    input: StructuredParseInput<T>
  ): Promise<z.infer<T>> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      input.timeoutMs ?? this.defaultTimeoutMs
    );

    try {
      const response = await this.sdk.messages.parse(
        {
          model: this.model,
          max_tokens: 1024,
          system: input.systemPrompt,
          messages: [{ role: "user", content: input.userPrompt }],
          output_config: {
            format: zodOutputFormat(input.schema),
          },
        },
        { signal: controller.signal }
      );

      const validated = input.schema.safeParse(response.parsed_output);
      if (!validated.success) {
        throw new LlmError(
          "LLM_INVALID_OUTPUT",
          validated.error.issues.map((i) => i.message).join("; ")
        );
      }
      return validated.data;
    } catch (err) {
      throw mapSdkError(err);
    } finally {
      clearTimeout(timeout);
    }
  }

  async runToolTurn(input: ToolTurnInput): Promise<ToolTurnOutput> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      input.timeoutMs ?? this.defaultTimeoutMs
    );

    try {
      const response = await this.sdk.messages.create(
        {
          model: this.model,
          max_tokens: input.maxTokens ?? 1024,
          system: input.systemPrompt,
          messages: toAnthropicMessages(input.messages),
          tools: input.tools.length > 0 ? toAnthropicTools(input.tools) : undefined,
        },
        { signal: controller.signal }
      );

      const textParts: string[] = [];
      const toolCalls: LlmToolCall[] = [];
      const assistantBlocks: LlmContentBlock[] = [];

      for (const block of response.content) {
        if (block.type === "text" && typeof block.text === "string") {
          textParts.push(block.text);
          assistantBlocks.push({ type: "text", text: block.text });
        } else if (
          block.type === "tool_use" &&
          typeof block.id === "string" &&
          typeof block.name === "string"
        ) {
          const toolInput =
            typeof block.input === "object" &&
            block.input !== null &&
            !Array.isArray(block.input)
              ? (block.input as Record<string, unknown>)
              : {};
          toolCalls.push({ id: block.id, name: block.name, input: toolInput });
          assistantBlocks.push({
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: toolInput,
          });
        }
      }

      return {
        stopReason: mapStopReason(response.stop_reason),
        text: textParts.join("\n").trim(),
        toolCalls,
        assistantBlocks,
      };
    } catch (err) {
      throw mapSdkError(err);
    } finally {
      clearTimeout(timeout);
    }
  }
}
