import { NextRequest } from "next/server";
import { z } from "zod";
import {
  checkChatRateLimit,
  errorResponse,
  jsonResponse,
} from "@/app/api/_utils";
import { getContainer } from "@/infra/container";

const ChatRequestSchema = z.object({
  message: z.string().min(1, "Message cannot be empty"),
});

export async function POST(req: NextRequest) {
  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      "anonymous";

    const rate = checkChatRateLimit(ip);
    if (!rate.allowed) {
      return jsonResponse(
        {
          code: "RATE_LIMITED",
          message:
            "Too many chat requests. Please wait a moment before sending another message.",
        },
        429
      );
    }

    const body = await req.json();
    const { message } = ChatRequestSchema.parse(body);

    const container = getContainer();
    const result = await container.agent.chat(message);

    return jsonResponse(result);
  } catch (err) {
    return errorResponse(err);
  }
}

