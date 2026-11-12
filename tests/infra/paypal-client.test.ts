import { describe, expect, it, vi } from "vitest";
import { PayPalClient, PayPalError } from "@/infra/paypal/client";

function makeJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("PayPalClient (T3.1, TDD 8.4)", () => {
  it("refuses to construct if env is not sandbox", () => {
    expect(
      () =>
        new PayPalClient({
          env: "live",
          clientId: "id",
          clientSecret: "secret",
        })
    ).toThrow(/sandbox/i);

    expect(
      () =>
        new PayPalClient({
          env: "production",
          clientId: "id",
          clientSecret: "secret",
        })
    ).toThrow(/sandbox/i);
  });

  it("caches OAuth token and refreshes before expiry", async () => {
    let nowMs = 1_700_000_000_000;
    let tokenCounter = 0;

    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      const urlStr = String(url);
      if (urlStr.endsWith("/v1/oauth2/token")) {
        tokenCounter += 1;
        return makeJsonResponse(200, {
          access_token: `tok-${tokenCounter}`,
          token_type: "Bearer",
          expires_in: 120,
        });
      }
      return makeJsonResponse(200, {
        id: "ORD-1",
        status: "PAYER_ACTION_REQUIRED",
        links: [
          {
            rel: "payer-action",
            href: "https://www.sandbox.paypal.com/checkoutnow?token=ORD-1",
            method: "GET",
          },
        ],
      });
    });

    const client = new PayPalClient({
      env: "sandbox",
      clientId: "cid",
      clientSecret: "csec",
      fetchFn: fetchMock,
      nowFn: () => nowMs,
      retryDelayMs: 0,
    });

    await client.createOrder({
      purchaseId: "pur-1",
      title: "Gels",
      amountCents: 2400,
      returnUrl: "http://localhost:3000/api/paypal/connect/return",
      cancelUrl: "http://localhost:3000/api/paypal/connect/cancel",
    });

    // Advance 30s (still well inside 120s TTL) -> reuses cached token
    nowMs += 30_000;
    await client.createOrder({
      purchaseId: "pur-2",
      title: "Shoes",
      amountCents: 8900,
      returnUrl: "http://localhost:3000/api/paypal/connect/return",
      cancelUrl: "http://localhost:3000/api/paypal/connect/cancel",
    });
    expect(tokenCounter).toBe(1);

    // Advance past refresh buffer (100s total >= 120 - 30) -> refreshes token
    nowMs += 70_000;
    await client.createOrder({
      purchaseId: "pur-3",
      title: "Vest",
      amountCents: 4500,
      returnUrl: "http://localhost:3000/api/paypal/connect/return",
      cancelUrl: "http://localhost:3000/api/paypal/connect/cancel",
    });
    expect(tokenCounter).toBe(2);
  });

  it("sends stable PayPal-Request-Id per purchase and step", async () => {
    const requestIds: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      const urlStr = String(url);
      if (urlStr.endsWith("/v1/oauth2/token")) {
        return makeJsonResponse(200, {
          access_token: "tok-1",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      const headers = new Headers(init?.headers);
      const reqId = headers.get("PayPal-Request-Id");
      if (reqId) requestIds.push(reqId);

      if (urlStr.endsWith("/capture")) {
        return makeJsonResponse(201, {
          id: "ORD-1",
          status: "COMPLETED",
          purchase_units: [
            {
              payments: {
                captures: [{ id: "CAP-1", status: "COMPLETED" }],
              },
            },
          ],
        });
      }
      return makeJsonResponse(200, {
        id: "ORD-1",
        status: "PAYER_ACTION_REQUIRED",
        links: [
          {
            rel: "payer-action",
            href: "https://www.sandbox.paypal.com/checkoutnow?token=ORD-1",
            method: "GET",
          },
        ],
      });
    });

    const client = new PayPalClient({
      env: "sandbox",
      clientId: "cid",
      clientSecret: "csec",
      fetchFn: fetchMock,
      retryDelayMs: 0,
    });

    await client.createOrder({
      purchaseId: "pur-abc",
      title: "Gels",
      amountCents: 2400,
      returnUrl: "http://localhost:3000/return",
      cancelUrl: "http://localhost:3000/cancel",
    });
    await client.createOrder({
      purchaseId: "pur-abc",
      title: "Gels",
      amountCents: 2400,
      returnUrl: "http://localhost:3000/return",
      cancelUrl: "http://localhost:3000/cancel",
    });
    await client.captureOrder({ purchaseId: "pur-abc", orderId: "ORD-1" });

    expect(requestIds).toEqual([
      "aa-pur-abc-create",
      "aa-pur-abc-create",
      "aa-pur-abc-capture",
    ]);
  });

  it("maps 401, 422, and 5xx errors and retries transient errors at most twice", async () => {
    const authFetch = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith("/v1/oauth2/token")) {
        return makeJsonResponse(401, { error: "invalid_client" });
      }
      return makeJsonResponse(500, {});
    });

    const authClient = new PayPalClient({
      env: "sandbox",
      clientId: "bad",
      clientSecret: "bad",
      fetchFn: authFetch,
      retryDelayMs: 0,
    });
    await expect(
      authClient.createOrder({
        purchaseId: "p1",
        title: "Item",
        amountCents: 1000,
        returnUrl: "http://localhost:3000/r",
        cancelUrl: "http://localhost:3000/c",
      })
    ).rejects.toMatchObject({ kind: "auth" });

    // 422 validation vs declined
    const validationFetch = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith("/v1/oauth2/token")) {
        return makeJsonResponse(200, { access_token: "tok", expires_in: 3600 });
      }
      return makeJsonResponse(422, {
        name: "UNPROCESSABLE_ENTITY",
        message: "Order not approved",
        details: [{ issue: "ORDER_NOT_APPROVED" }],
      });
    });
    const valClient = new PayPalClient({
      env: "sandbox",
      clientId: "cid",
      clientSecret: "csec",
      fetchFn: validationFetch,
      retryDelayMs: 0,
    });
    await expect(
      valClient.captureOrder({ purchaseId: "p2", orderId: "ORD-2" })
    ).rejects.toBeInstanceOf(PayPalError);
    await expect(
      valClient.captureOrder({ purchaseId: "p2", orderId: "ORD-2" })
    ).rejects.toMatchObject({ kind: "validation" });

    // 5xx retries at most twice (1 initial + 2 retries = 3 calls to /orders)
    let orderAttempts = 0;
    const serverErrFetch = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith("/v1/oauth2/token")) {
        return makeJsonResponse(200, { access_token: "tok", expires_in: 3600 });
      }
      orderAttempts += 1;
      return makeJsonResponse(503, { message: "Service unavailable" });
    });
    const transientClient = new PayPalClient({
      env: "sandbox",
      clientId: "cid",
      clientSecret: "csec",
      fetchFn: serverErrFetch,
      retryDelayMs: 0,
    });
    await expect(
      transientClient.createOrder({
        purchaseId: "p3",
        title: "Item",
        amountCents: 1000,
        returnUrl: "http://localhost:3000/r",
        cancelUrl: "http://localhost:3000/c",
      })
    ).rejects.toMatchObject({ kind: "transient" });
    expect(orderAttempts).toBe(3);
  });
});
