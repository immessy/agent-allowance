import { NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, jsonResponse } from "@/app/api/_utils";
import { getContainer } from "@/infra/container";

const ParseRequestSchema = z.object({
  text: z.string().min(1, "Mandate text is required"),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text } = ParseRequestSchema.parse(body);
    const container = getContainer();
    const result = await container.mandates.parseMandate(text);
    return jsonResponse(result);
  } catch (err) {
    return errorResponse(err);
  }
}

