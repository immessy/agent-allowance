import type { z } from "zod";
import {
  LlmError,
  type LlmClient,
  type StructuredParseInput,
  type ToolTurnInput,
  type ToolTurnOutput,
} from "@/services/llm-client";

export interface ScriptedLlmOptions {
  structuredResponses?: unknown[];
  structuredHandler?: (userPrompt: string) => unknown | Promise<unknown>;
  toolTurns?: Array<ToolTurnOutput | Error>;
  toolTurnHandler?: (
    input: ToolTurnInput
  ) => ToolTurnOutput | Promise<ToolTurnOutput>;
}

/**
 * Deterministic ScriptedLlmClient for unit tests and MOCK_LLM=1 demo mode.
 */
export class ScriptedLlmClient implements LlmClient {
  private readonly structuredQueue: unknown[];
  private readonly structuredHandler?: (
    userPrompt: string
  ) => unknown | Promise<unknown>;
  private readonly toolTurnQueue: Array<ToolTurnOutput | Error>;
  private readonly toolTurnHandler?: (
    input: ToolTurnInput
  ) => ToolTurnOutput | Promise<ToolTurnOutput>;

  constructor(options: ScriptedLlmOptions = {}) {
    this.structuredQueue = [...(options.structuredResponses ?? [])];
    this.structuredHandler = options.structuredHandler;
    this.toolTurnQueue = [...(options.toolTurns ?? [])];
    this.toolTurnHandler = options.toolTurnHandler;
  }

  async parseStructured<T extends z.ZodType>(
    input: StructuredParseInput<T>
  ): Promise<z.infer<T>> {
    let raw: unknown;
    if (this.structuredQueue.length > 0) {
      raw = this.structuredQueue.shift();
    } else if (this.structuredHandler) {
      raw = await this.structuredHandler(input.userPrompt);
    } else {
      throw new LlmError(
        "LLM_FAILED",
        "No scripted structured response configured."
      );
    }

    if (raw instanceof Error) {
      throw raw;
    }

    const parsed = input.schema.safeParse(raw);
    if (!parsed.success) {
      throw new LlmError(
        "LLM_INVALID_OUTPUT",
        parsed.error.issues.map((i) => i.message).join("; ")
      );
    }
    return parsed.data;
  }

  async runToolTurn(input: ToolTurnInput): Promise<ToolTurnOutput> {
    if (this.toolTurnQueue.length > 0) {
      const next = this.toolTurnQueue.shift();
      if (next instanceof Error) {
        throw next;
      }
      if (next) {
        return next;
      }
    }

    if (this.toolTurnHandler) {
      return this.toolTurnHandler(input);
    }

    throw new LlmError("LLM_FAILED", "No scripted tool turn configured.");
  }
}

