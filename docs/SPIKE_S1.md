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

### 3. Vault v3 (Mode A feasibility & T0.4 result)
- **Create Setup Token:** `POST /v3/vault/setup-tokens` with `PayPal-Request-Id` and:
  ```json
  {
    "payment_source": {
      "paypal": {
        "usage_type": "MERCHANT",
        "customer_type": "CONSUMER",
        "permit_multiple_payment_tokens": true,
        "experience_context": {
          "brand_name": "Agent Allowance",
          "shipping_preference": "NO_SHIPPING",
          "return_url": "https://example.com/paypal-vault-return",
          "cancel_url": "https://example.com/paypal-vault-cancel"
        }
      }
    }
  }
  ```
- **API result:** `201 Created`, setup token ID `00751182AD290262M`, `status: "PAYER_ACTION_REQUIRED"`, `links` with `rel: "approve"` (`https://www.sandbox.paypal.com/agreements/approve?approval_session_id=<id>`).
- **Live buyer consent outcome (T0.4):** After buyer login with multiple personal sandbox accounts on `www.sandbox.paypal.com/agreements/approve`, PayPal's hosted UI errored with *"Things don't appear to be working at the moment"*. `GET /v3/vault/setup-tokens/00751182AD290262M` remained `200 PAYER_ACTION_REQUIRED`.
- **Root cause:** PayPal Wallet Vaulting is region-restricted (only US, CA, UK, EU, AU, SG, JP, HK, CN; not India) and requires Vault/Reference Transactions enabled on a supported-region Sandbox Business account matching the buyer's flow.

### Final Decision (T0.4 Fallback Applied)
**Switched to Mode B (Orders v2 buyer-approval redirect + server-side capture).** Mode B avoids Vault v3 / Reference Transactions sandbox account eligibility blockers while preserving the exact policy engine, Approval Inbox, and AG Grid ledger architecture.

---

## Spike S2: LLM Connectivity (T0.3)

- **Configured model (`ANTHROPIC_MODEL`):** `claude-haiku-5-5`
- **(a) Structured output (`messages.parse` with `zodOutputFormat`):** **Passed** (`model: "claude-haiku-5-5"`, `stop_reason: "end_turn"`). Parsed the PRD Section 10 mandate into exact cents (`monthlyCapCents: 15000`, `autoApproveLimitCents: 5000`, `hardLimitCents: 12000`, `allowedCategories: ["running gear", "nutrition"]`, `blockedMerchants: ["ShadyDeals"]`, `clarifyingQuestion: null`).
- **(b) Tool use (`messages.create` with `tools`):** **Passed** (`model: "claude-haiku-5-5"`, `stop_reason: "tool_use"`, invoked `search_products`).
