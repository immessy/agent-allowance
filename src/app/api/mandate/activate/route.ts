import { NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, jsonResponse } from "@/app/api/_utils";
import { MandateDraftSchema } from "@/domain/schemas";
import { getContainer } from "@/infra/container";

const ActivateRequestSchema = z.object({
  draft: MandateDraftSchema,
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { draft } = ActivateRequestSchema.parse(body);
    const container = getContainer();
    const active = container.mandates.activateMandate({ draft });
    return jsonResponse({ mandate: active });
  } catch (err) {
    return errorResponse(err);
  }
}

