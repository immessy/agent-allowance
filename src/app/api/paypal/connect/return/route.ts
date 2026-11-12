import { NextRequest, NextResponse } from "next/server";
import { errorResponse, jsonResponse } from "@/app/api/_utils";
import { getContainer } from "@/infra/container";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim() ?? "";
  const wantsJson = req.nextUrl.searchParams.get("format") === "json";
  const container = getContainer();

  if (!token) {
    if (wantsJson) {
      return jsonResponse(
        { code: "INVALID_INPUT", message: "Missing PayPal order token." },
        400
      );
    }
    return NextResponse.redirect(
      new URL("/?paypal=missing_token", container.config.appBaseUrl)
    );
  }

  try {
    const purchase = await container.approvals.completeOrderCapture(token);
    if (wantsJson) {
      return jsonResponse({ purchase });
    }
    return NextResponse.redirect(
      new URL(
        `/?paypal=success&orderId=${encodeURIComponent(token)}`,
        container.config.appBaseUrl
      )
    );
  } catch (err) {
    if (wantsJson) {
      return errorResponse(err);
    }
    const message = err instanceof Error ? err.message : "capture_failed";
    return NextResponse.redirect(
      new URL(
        `/?paypal=error&message=${encodeURIComponent(message)}`,
        container.config.appBaseUrl
      )
    );
  }
}
