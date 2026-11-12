import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { DomainError } from "@/domain/errors";
import { LlmError } from "@/services/llm-client";

export function jsonResponse(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ZodError) {
    return jsonResponse(
      {
        code: "VALIDATION_ERROR",
        message: err.issues.map((i) => i.message).join("; "),
        details: err.issues,
      },
      400
    );
  }

  if (err instanceof DomainError) {
    const status =
      err.code === "NOT_FOUND" ||
      err.code === "APPROVAL_NOT_FOUND" ||
      err.code === "PURCHASE_NOT_FOUND" ||
      err.code === "ORDER_NOT_FOUND"
        ? 404
        : err.code === "FORBIDDEN"
        ? 403
        : err.code === "APPROVAL_ALREADY_REJECTED" ||
          err.code === "APPROVAL_ALREADY_GRANTED" ||
          err.code === "PURCHASE_NOT_PAYABLE"
        ? 409
        : err.code === "INVALID_INPUT" || err.code === "INVALID_MANDATE"
        ? 400
        : 422;
    return jsonResponse({ code: err.code, message: err.message }, status);
  }

  if (err instanceof LlmError) {
    const status =
      err.code === "LLM_AUTH"
        ? 401
        : err.code === "LLM_TRANSIENT" || err.code === "LLM_TIMEOUT"
        ? 503
        : 500;
    return jsonResponse({ code: err.code, message: err.message }, status);
  }

  return jsonResponse(
    {
      code: "INTERNAL_ERROR",
      message: err instanceof Error ? err.message : "An unexpected error occurred.",
    },
    500
  );
}

// In-memory chat rate limiter: 30 requests per minute per IP/client
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function checkChatRateLimit(identifier = "anonymous"): {
  allowed: boolean;
  remaining: number;
} {
  const now = Date.now();
  const windowMs = 60_000;
  const maxRequests = 30;

  const entry = rateLimitMap.get(identifier);
  if (!entry || entry.resetAt <= now) {
    rateLimitMap.set(identifier, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1 };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0 };
  }

  entry.count += 1;
  return { allowed: true, remaining: maxRequests - entry.count };
}
