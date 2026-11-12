import { errorResponse, jsonResponse } from "@/app/api/_utils";
import { getContainer } from "@/infra/container";

export async function GET() {
  try {
    const container = getContainer();
    const summary = container.mandates.getActiveSummary();
    return jsonResponse(summary);
  } catch (err) {
    return errorResponse(err);
  }
}

