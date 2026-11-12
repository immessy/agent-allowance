import { NextRequest, NextResponse } from "next/server";
import { jsonResponse } from "@/app/api/_utils";
import { getContainer } from "@/infra/container";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim() ?? "";
  const wantsJson = req.nextUrl.searchParams.get("format") === "json";
  const container = getContainer();

  if (token) {
    container.approvals.cancelOrderRedirect(token);
  }

  if (wantsJson) {
    return jsonResponse({
      cancelled: true,
      orderId: token || null,
    });
  }

  return NextResponse.redirect(
    new URL(
      `/?paypal=cancelled${token ? `&orderId=${encodeURIComponent(token)}` : ""}`,
      container.config.appBaseUrl
    )
  );
}

