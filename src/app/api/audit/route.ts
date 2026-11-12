import { NextRequest } from "next/server";
import { errorResponse, jsonResponse } from "@/app/api/_utils";
import { getContainer } from "@/infra/container";

export async function GET(req: NextRequest) {
  try {
    const typeFilter = req.nextUrl.searchParams.get("type")?.trim() ?? "";
    const limitParam = req.nextUrl.searchParams.get("limit");
    const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : 500;
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 1000)
        : 500;

    const container = getContainer();
    const events = container.audit
      .listAll(limit)
      .filter((event) => !typeFilter || event.type === typeFilter);

    return jsonResponse({ events });
  } catch (err) {
    return errorResponse(err);
  }
}

