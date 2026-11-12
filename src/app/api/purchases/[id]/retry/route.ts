import { NextRequest } from "next/server";
import { errorResponse, jsonResponse } from "@/app/api/_utils";
import { getContainer } from "@/infra/container";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const container = getContainer();
    const purchase = await container.approvals.retryOrderForPurchase(id);
    return jsonResponse({ purchase });
  } catch (err) {
    return errorResponse(err);
  }
}

