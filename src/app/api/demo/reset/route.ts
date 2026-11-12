import { errorResponse, jsonResponse } from "@/app/api/_utils";
import { getContainer } from "@/infra/container";

export async function POST() {
  try {
    const container = getContainer();
    const res = container.resetDemoData();
    return jsonResponse(res);
  } catch (err) {
    return errorResponse(err);
  }
}

