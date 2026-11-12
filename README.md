# Agent Allowance

> **Deterministic spending guardrails for AI shopping agents.**  
> Give autonomous buying agents the freedom to find products and draft orders, while enforcing mathematical budget caps, category limits, merchant blocklists, human-in-the-loop approvals, and PayPal sandbox payments backed by an immutable audit ledger.

[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)
[![Tests: Vitest](https://img.shields.io/badge/Tests-83%20passed-success.svg)](tests)
[![Next.js: 16](https://img.shields.io/badge/Next.js-16%20App%20Router-black.svg)](https://nextjs.org)
[![TypeScript: Strict](https://img.shields.io/badge/TypeScript-Strict%20noAny-blue.svg)](tsconfig.json)

---

## The Problem & The Pitch

Autonomous AI shopping agents represent the future of commerce, but giving an LLM direct access to a credit card is dangerous: LLMs hallucinate, suffer from prompt injections, and cannot be trusted with unbounded financial authority.

**Agent Allowance** solves this by inserting a deterministic, tamper-proof guardrails layer between the LLM and the payment rail:
- **The LLM never touches money:** The agent can search products, inspect budgets, and submit purchase requests, but the backend policy engine independently authorizes or denies every single cent.
- **Natural language mandates:** Users define spending rules in plain English (e.g., *"Spend up to $150/month on running gear and nutrition. Auto-approve up to $50. Never spend over $120, and never buy from ShadyDeals."*). Claude parses this into a structured schema, but activation is explicit.
- **Human-in-the-loop approvals:** Purchases above the auto-approve threshold or flagged by security heuristics are routed to an Approval Inbox where humans approve or reject before payment can proceed. Stale approvals are re-evaluated against the current calendar-month budget at execution time.
- **PayPal Mode B integration:** PayPal authenticates the buyer and captures funds via Orders v2 server-side idempotent capture.
- **Immutable audit ledger:** Every policy evaluation, human decision, security flag, and PayPal event is recorded in SQLite with append-only access (no `UPDATE` or `DELETE` methods in the data layer).

---

## 5-Step Setup

### 1. Clone the repository
```bash
git clone https://github.com/immessy/agent-allowance.git
cd agent-allowance
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Fill in your credentials (see below). For zero-configuration offline exploration, you can run in mock mode without any API keys.

### 4. Build the application
```bash
npm run build
```

### 5. Start the server
```bash
npm run dev
# or for production server:
npm start
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

## How to Get PayPal Sandbox Credentials & Buyer Account

1. Log into the **[PayPal Developer Dashboard](https://developer.paypal.com/)**.
2. Navigate to **Apps & Credentials** and select the **Sandbox** tab.
3. Click **Create App**, name it `Agent Allowance`, and create it under your default Business sandbox account.
4. Copy the **Client ID** and **Secret Key** into `.env`:
   ```env
   PAYPAL_ENV=sandbox
   PAYPAL_CLIENT_ID=your-client-id-here
   PAYPAL_CLIENT_SECRET=your-client-secret-here
   ```
5. Navigate to **Testing Tools → Sandbox Accounts** in the developer dashboard:
   - Your **Business Account** acts as the merchant store receiving payments.
   - Your **Personal Account** (e.g. `sb-xxxx@personal.example.com`) acts as the test buyer. Click the three dots `...` next to the personal account, choose **View/Edit account**, and note or set the login password.
   - Use this personal sandbox buyer account when logging into the PayPal checkout page.

> [!NOTE]  
> **Digital Goods & Shipping in Sandbox:** In this application, purchase units are submitted with `category: "DIGITAL_GOODS"` and `shipping_preference: "NO_SHIPPING"` in the PayPal experience context. This standardizes the sandbox checkout experience, ensures instant server-side capture, and avoids physical shipping address validation failures across international sandbox test accounts.

---

## Execution Modes: Live vs. Simulated vs. Mock LLM

| Mode | Configuration in `.env` | Description |
|---|---|---|
| **Live PayPal Sandbox** *(Default)* | `PAYPAL_CLIENT_ID=...`<br>`PAYPAL_CLIENT_SECRET=...` | Connects directly to `https://api-m.sandbox.paypal.com`. Creates Orders v2 orders with `user_action=PAY_NOW`, redirects buyer to sandbox approval, and executes server-side idempotent capture. |
| **Simulated Payment Mode** | `PAYMENT_MODE=simulated` | Replaces PayPal network calls with an in-memory redirect simulator (`FakePaymentExecutor`). Simulated orders are assigned `SIM-ORD-*` IDs and all UI elements and ledger entries are explicitly badged **`[SIMULATED]`**. |
| **Mock LLM Mode** | `MOCK_LLM=1` | Replaces Anthropic Claude API calls with deterministic `ScriptedLlmClient` fixtures for automated tests and predictable demonstration of all 5 PRD scenarios without consuming LLM tokens. |
| **Live Anthropic LLM** | `ANTHROPIC_API_KEY=sk-ant-...`<br>`ANTHROPIC_MODEL=claude-haiku-5-5` | Uses Claude with structured outputs (`zodOutputFormat`) and multi-turn tool calling (`search_products`, `get_budget`, `request_purchase`). |

---

## Running Tests & Quality Checks

The project enforces strict Test-Driven Development (TDD), zero TypeScript compiler warnings, and strict ESLint rules:

```bash
# Run Vitest test suite (83 unit and integration tests)
npm test

# Run TypeScript strict typecheck (noEmit)
npm run typecheck

# Run ESLint
npm run lint

# Run Next.js production build
npm run build
```

---

## Tech Stack & Architecture

- **Framework:** Next.js 16 (App Router) + React 19
- **Language:** TypeScript 5 (strict mode, `noUncheckedIndexedAccess: true`, `@typescript-eslint/no-explicit-any: error`)
- **Styling:** Tailwind CSS + PostCSS
- **Database:** SQLite via `better-sqlite3` with strict migrations and append-only audit repository
- **Data Table:** AG Grid Community v36 (`ag-grid-react` with quick filter, sorting, and custom badge renderers)
- **Validation:** Zod v4 schemas for all domain entities, inputs, and external API responses
- **LLM Client:** `@anthropic-ai/sdk` with `messages.parse` structured output and `messages.create` tool-calling loop
- **Payment Rail:** PayPal REST API (OAuth 2.0 client credentials, Orders v2 Mode B redirect + capture with `PayPal-Request-Id` idempotency)
- **Test Runner:** Vitest 5

### Architectural Boundary Guard
A dedicated architectural test (`tests/architecture/imports.test.ts`) verifies that:
1. `src/domain` is strictly pure and imports nothing from `infra`, `services`, or `app`.
2. `src/infra/paypal/executor.ts` is the **only** module in the entire application allowed to import `src/infra/paypal/client.ts`.

---

## The Five PRD Demo Scenarios

The catalog (`src/data/products.json`) and test suites demonstrate five canonical scenarios under the baseline mandate ($150.00/month cap, $50.00 auto limit, $120.00 hard limit, running gear + nutrition):

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Scenario 1: Cheap In-Category Item ($24 Energy Gels)                                   │
│ Prompt: "Get me a pack of energy gels"                                                 │
│ Policy Decision: APPROVE (WITHIN_MANDATE)                                              │
│ Result: Automatically approved under $50 limit; PayPal order created; captured.        │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Scenario 2: Over Auto-Approve Limit ($89 Trail Shoes)                                  │
│ Prompt: "I need trail running shoes"                                                   │
│ Policy Decision: ASK_HUMAN (OVER_AUTO_LIMIT)                                           │
│ Result: Routed to Approval Inbox; human approves; policy re-evaluates; captured.       │
│ Budget Status: $24 + $89 = $113 captured ($37 remaining).                              │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Scenario 3: Disallowed Category & Hard Limit ($249 GPS Watch)                          │
│ Prompt: "Buy me a GPS sports watch"                                                    │
│ Policy Decision: DENY (CATEGORY_NOT_ALLOWED)                                           │
│ Result: Blocked because electronics is outside mandate and $249 > $120 hard limit.     │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Scenario 4: Security Heuristic / Prompt-Injection Bait ($58 Headlamp)                  │
│ Prompt: "Get the cheapest headlamp"                                                    │
│ Policy Decision: ASK_HUMAN (OVER_AUTO_LIMIT)                                           │
│ Result: Catalog scanner detects injection text, logs SUSPICIOUS_CONTENT_FLAGGED to     │
│ the immutable ledger, but policy evaluates purely on price ($58 > $50) -> ASK_HUMAN.   │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Scenario 5: Exceeding Monthly Budget ($45 Hydration Vest)                               │
│ Prompt: "Get a $45 hydration vest"                                                     │
│ Policy Decision: DENY (OVER_MONTHLY_BUDGET)                                            │
│ Result: Even though $45 < $50 auto limit, $45 exceeds remaining $37 budget -> DENIED.  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Security & Guardrail Invariants

1. **Safety First:** The LLM cannot execute financial transactions. It can only call `request_purchase`, which submits requests to the deterministic policy engine.
2. **Deterministic Evaluation:** Policy rules evaluate in strict order (validity → active mandate → blocked merchant → allowed category → hard limit → monthly budget → auto-approve limit).
3. **Integer Cents:** All currency values are stored, calculated, and compared as integer cents (`Cents = number & { readonly __brand: unique symbol }`) to eliminate floating-point rounding errors.
4. **Time Window Accuracy:** Monthly budgets are evaluated strictly within the UTC calendar month (`YYYY-MM-01T00:00:00.000Z` to `YYYY-MM-lastT23:59:59.999Z`).
5. **Prompt-Injection Defense:** All catalog search results returned to the LLM are wrapped in `<untrusted_product_data>` tags and scanned for adversarial instructions.
6. **Append-Only Audit Trail:** The database layer provides only `insert` and `read` methods for audit records.

---

## License

This project is licensed under the [MIT License](LICENSE).
