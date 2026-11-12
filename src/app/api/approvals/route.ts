import { errorResponse, jsonResponse } from "@/app/api/_utils";
import { getContainer } from "@/infra/container";

export async function GET() {
  try {
    const container = getContainer();
    const approvals = container.approvals.listApprovals();
    return jsonResponse({ approvals });
  } catch (err) {
    return errorResponse(err);
  }
}

