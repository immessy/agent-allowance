import type { z } from "zod";

export type LlmErrorCode =
  | "LLM_TIMEOUT"
  | "LLM_TRANSIENT"
  | "LLM_INVALID_OUTPUT"
  | "LLM_AUTH"
  | "LLM_FAILED";

/**
 * Typed error raised by LLM client implementations without leaking secrets.
 */
export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly retryable: boolean;

  constructor(code: LlmErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "LlmError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface LlmToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LlmToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type LlmContentBlock =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      toolUseId: string;
      content: string;
      isError?: boolean;
    };

export interface LlmMessage {
  role: "user" | "assistant";
  content: string | LlmContentBlock[];
}

export interface StructuredParseInput<T extends z.ZodType> {
  systemPrompt: string;
  userPrompt: string;
  schema: T;
  timeoutMs?: number;
}

export interface ToolTurnInput {
  systemPrompt: string;
  messages: LlmMessage[];
  tools: LlmToolDefinition[];
  timeoutMs?: number;
  maxTokens?: number;
}

export interface ToolTurnOutput {
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "other";
  text: string;
  toolCalls: LlmToolCall[];
  assistantBlocks: LlmContentBlock[];
}

/**
 * Provider-agnostic interface for structured parsing and tool-use conversation turns.
 */
export interface LlmClient {
  parseStructured<T extends z.ZodType>(
    input: StructuredParseInput<T>
  ): Promise<z.infer<T>>;
  runToolTurn(input: ToolTurnInput): Promise<ToolTurnOutput>;
}

