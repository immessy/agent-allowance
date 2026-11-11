# Spike S1 & S2 Report

Date: 2026-11-11  
Environment: `PAYPAL_ENV=sandbox` (`https://api-m.sandbox.paypal.com`)

---

## Spike S1: PayPal Sandbox Feasibility (T0.2)

### 1. OAuth 2.0 Access Token
- **Endpoint:** `POST /v1/oauth2/token` (`grant_type=client_credentials`, Basic auth)
- **Result:** `200 OK` (`token_type: Bearer`, `expires_in: 32400`, sandbox app `APP-5U583379257226100`).
- **Scopes verified:** Includes 29 scopes, notably:
  - `https://uri.paypal.com/services/vault/payment-tokens/read`
  - `https://uri.paypal.com/services/vault/payment-tokens/readwrite`
  - `https://uri.paypal.com/services/payments/payment/authcapture`

### 2. Orders v2 (Mode B baseline)
- **Create Order:** `POST /v2/checkout/orders` with `PayPal-Request-Id`, `intent: "CAPTURE"`, `purchase_units` (USD + item breakdown), and `payment_source.paypal.experience_context` (`return_url`, `cancel_url`, `user_action: "PAY_NOW"`).
- **Result:** `200 OK`, order ID `2VT03522D0092194K`, `status: "PAYER_ACTION_REQUIRED"`, with `rel: "payer-action"` link (`https://www.sandbox.paypal.com/...`).
  - *Doc note vs. TDD:* Using `payment_source.paypal.experience_context` returns `200` and `rel: "payer-action"` (legacy `application_context` returns `rel: "approve"`).
- **Capture Order before approval:** `POST /v2/checkout/orders/{id}/capture` returns `422 UNPROCESSABLE_ENTITY` (`ORDER_NOT_APPROVED`).
- **Minimum steps for Mode B:**
  1. `POST /v2/checkout/orders` with `experience_context` -> redirect buyer to `payer-action` URL.
  2. Buyer logs into sandbox personal account and approves.
  3. Return handler captures via `POST /v2/checkout/orders/{id}/capture` with `PayPal-Request-Id`.

### 3. Vault v3 (Mode A feasibility)
- **Create Setup Token:** `POST /v3/vault/setup-tokens` with `PayPal-Request-Id` and:
  ```json
  {
    "payment_source": {
      "paypal": {
        "usage_type": "MERCHANT",
        "experience_context": {
          "brand_name": "Agent Allowance",
          "return_url": "http://localhost:3000/api/paypal/connect/return",
          "cancel_url": "http://localhost:3000/api/paypal/connect/cancel"
        }
      }
    }
  }
  ```
- **Result:** **`201 Created`**, setup token ID `3HS06098HK104090V`, `status: "PAYER_ACTION_REQUIRED"`, with `rel: "approve"` link (`https://www.sandbox.paypal.com/agreements/approve?...`).
- **Payment Tokens API check:** `GET /v3/vault/payment-tokens?customer_id=spike_probe` returned `404 RESOURCE_NOT_FOUND` (`CUSTOMER_ID_NOT_FOUND`) rather than `403`, confirming Vault v3 permissions are enabled on this sandbox app.
- **Full Mode A flow (per official PayPal Vault v3 + Orders v2 docs):**
  1. One-time "Connect PayPal": call `POST /v3/vault/setup-tokens`, redirect user to `approve` URL to log in once with a sandbox buyer account and click Agree & Save.
  2. Return handler: call `POST /v3/vault/payment-tokens` with `payment_source: { token: { id: "<setupTokenId>", type: "SETUP_TOKEN" } }` to mint a permanent `vault_id`.
  3. Server-side purchase execution (no buyer redirect): call `POST /v2/checkout/orders` with `intent: "CAPTURE"` and `payment_source: { paypal: { vault_id: "<vaultId>" } }` (and call `POST /v2/checkout/orders/{id}/capture` if the returned status is not already `COMPLETED`).

### Blockers / Caveats
- Mode A still requires **one-time interactive approval** in a browser with a PayPal sandbox buyer account (to convert a `setup_token` into a `vault_id`). After that one-time connect, purchases capture autonomously server-side.
- Mode B requires interactive buyer approval on every `APPROVE` and approved `ASK_HUMAN` purchase.

### Recommendation
**Recommend Mode A (Vaulted PayPal wallet).** Vault v3 is already enabled on this sandbox app (`201 Created` on `/v3/vault/setup-tokens`, `readwrite` Vault scope active), and one-time wallet connection aligns directly with the product promise ("grant the agent an allowance" so routine `APPROVE` purchases execute autonomously without redirecting away from chat).

---

## Spike S2: LLM Connectivity (T0.3)

- **Configured model (`ANTHROPIC_MODEL`):** `claude-haiku-5-5`
- **(a) Structured output (`messages.parse` with `zodOutputFormat`):** **Passed** (`model: "claude-haiku-5-5"`, `stop_reason: "end_turn"`). Parsed the PRD Section 10 mandate into exact cents (`monthlyCapCents: 15000`, `autoApproveLimitCents: 5000`, `hardLimitCents: 12000`, `allowedCategories: ["running gear", "nutrition"]`, `blockedMerchants: ["ShadyDeals"]`, `clarifyingQuestion: null`).
- **(b) Tool use (`messages.create` with `tools`):** **Passed** (`model: "claude-haiku-5-5"`, `stop_reason: "tool_use"`, invoked `search_products`).
