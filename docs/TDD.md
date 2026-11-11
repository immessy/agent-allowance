# TDD: Agent Allowance (Technical Design Document)

Companion to `PRD.md`. This document defines the architecture, contracts, and test plan. It contains no implementation code by design.

---

## 1. Architecture overview

```
 Browser (Next.js UI)
   |  Mandate panel | Agent chat | Approval Inbox | AG Grid ledger
   v
 Next.js API routes (TypeScript, server-side only secrets)
   |
   +-- Mandate service ----> LLM provider (structured output, Zod-validated)
   |
   +-- Agent service ------> LLM provider (tool-use loop, max 6 iterations)
   |        tools: search_products | get_budget | request_purchase
   |                                                    |
   |                                                    v
   |                                           Purchase Orchestrator
   |                                             1. Policy Engine (pure)
   |                                             2. Audit log write
   |                                             3. APPROVE -> Executor
   |                                                ASK_HUMAN -> Approval record
   |                                                DENY -> stop
   |                                                    |
   |                                                    v
   |                                            Executor (ONLY module that
   |                                            imports the PayPal client)
   |                                                    |
   +-- Product provider (local catalog; Channel3 optional)
   |
   +-- SQLite (mandates, purchases, approvals, audit_events)
                                                        |
                                                        v
                                                  PayPal sandbox REST API
```

### Non-negotiable invariants

1. **The LLM never moves money.** It can only call `request_purchase`, which routes through the policy engine.
2. **The policy engine is pure.** No network, no database, no clock access. Inputs in, decision out. "Now" is passed in as a parameter.
3. **Only the Executor imports the PayPal client.** A test enforces this.
4. **Policy is re-evaluated at approval time**, to prevent stale approvals (budget changed since the request).
5. **Every state change writes an audit event** in the same database transaction.
6. **Sandbox only.** Startup fails if PayPal config is not sandbox.
7. **Tool results are untrusted data.** Product text never goes into the system prompt and is wrapped and labelled as untrusted in tool results.

## 2. Tech stack

| Concern | Choice | Reason |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | One repo, API routes plus UI, easy Render deploy |
| UI | Tailwind CSS, small component set | Fast, consistent |
| Ledger | AG Grid Community (`ag-grid-react`) | Sponsor prize fit |
| Validation | Zod | Schemas shared between LLM output, API, and DB layer |
| DB | SQLite via `better-sqlite3` | Zero infrastructure, seeded on boot |
| LLM | Anthropic SDK, model from `ANTHROPIC_MODEL` env | Structured output and tool use. Provider hidden behind an `LlmClient` interface |
| Payments | PayPal REST API v2 Orders (+ Vault v3 if the spike passes) | Official, sandbox available |
| Tests | Vitest (unit and integration), optional Playwright smoke | Fast TDD loop |
| Hosting | Render web service | Sponsor tool, simple |

## 3. Repository layout

```
/
  LICENSE                  MIT
  README.md
  AGENT.md                 rules for coding agents
  TASK.md                  work plan
  .env.example
  docs/                    PRD.md, TDD.md, architecture image (optional)
  src/
    app/                   Next.js pages and API routes
    domain/                policy engine, money utils, schemas, types (NO imports from infra)
    services/              mandate, agent, orchestrator, approvals, audit
    infra/                 db, llm client, paypal client, product providers
    data/                  products.json seed catalog
    components/            UI components
  tests/                   mirrors src structure; fixtures for LLM scripts
```

Dependency direction: `app` and `services` depend on `domain` and `infra`. `domain` depends on nothing.

## 4. Domain model

All money is stored and computed as **integer cents**, USD only.

### Mandate
| Field | Type | Notes |
|---|---|---|
| id | string | |
| status | `draft` or `active` or `archived` | One active mandate at a time |
| sourceText | string | Original user text |
| monthlyCapCents | int > 0 | Required |
| autoApproveLimitCents | int ≥ 0 | Per item total (price x qty). At or below this and no other rule triggered means APPROVE |
| hardLimitCents | int ≥ autoApproveLimit | Per item total above this means DENY |
| allowedCategories | string[] (non-empty) | Matched case-insensitively against product category |
| blockedMerchants | string[] | Case-insensitive match |
| createdAt, activatedAt | ISO timestamps | |

Schema validation rejects: hard limit below auto-approve limit, cap below hard limit is allowed but flagged in the preview as a warning, empty categories.

### Product
`id`, `title`, `description`, `priceCents`, `category`, `merchant`, `imageEmoji`, `flags` (internal, for seeded demo items).

### PurchaseRequest (input to policy)
`productId`, `merchant`, `category`, `unitPriceCents`, `quantity`, derived `totalCents`.

### PolicyContext
`mandate`, `spentThisMonthCents` (captured purchases in the current calendar month, UTC), `now`.

### PolicyDecision
| Field | Notes |
|---|---|
| decision | `APPROVE` or `ASK_HUMAN` or `DENY` |
| reasonCode | See table below |
| explanation | Human-readable, includes the numbers |
| remainingBudgetCents | After the decision, assuming the purchase happens |
| rulesEvaluated | Ordered list of rule names with pass or fail, for the ledger |

### Policy evaluation order (first match wins)

| # | Rule | Result | reasonCode |
|---|---|---|---|
| 0 | Invalid request (qty < 1, price ≤ 0) | DENY | `INVALID_REQUEST` |
| 1 | No active mandate | DENY | `NO_ACTIVE_MANDATE` |
| 2 | Merchant in blockedMerchants | DENY | `MERCHANT_BLOCKED` |
| 3 | Category not in allowedCategories | DENY | `CATEGORY_NOT_ALLOWED` |
| 4 | total > hardLimit | DENY | `OVER_HARD_LIMIT` |
| 5 | total > remaining monthly budget | DENY | `OVER_MONTHLY_BUDGET` |
| 6 | total > autoApproveLimit | ASK_HUMAN | `OVER_AUTO_LIMIT` |
| 7 | Otherwise | APPROVE | `WITHIN_MANDATE` |

Rule 2 to 5 are checked and **all failures are recorded** in `rulesEvaluated`, but the first failing rule determines the primary `reasonCode`. For the demo watch scenario (price $249, out of category), the explanation should mention both category and hard limit.

Remaining monthly budget = `monthlyCap - spentThisMonth`. Pending approvals do not reserve budget. They are re-checked on approval.

### Other tables
- **purchases:** id, productId, title, merchant, category, quantity, totalCents, status (`pending_approval`, `approved`, `captured`, `rejected`, `denied`, `failed`), policyDecision JSON, paypalOrderId, createdAt, updatedAt
- **approvals:** id, purchaseId, status (`pending`, `approved`, `rejected`), decidedAt
- **audit_events:** id, timestamp, type, purchaseId (nullable), actor (`user`, `agent`, `policy`, `system`, `paypal`), summary, payload JSON. Append-only: no update or delete methods exist in the data layer.

### Audit event types
`MANDATE_PARSED`, `MANDATE_ACTIVATED`, `AGENT_REQUEST`, `PRODUCT_SEARCH`, `POLICY_DECISION`, `APPROVAL_REQUESTED`, `APPROVAL_GRANTED`, `APPROVAL_REJECTED`, `PAYPAL_ORDER_CREATED`, `PAYPAL_CAPTURED`, `PAYPAL_FAILED`, `SUSPICIOUS_CONTENT_FLAGGED`, `DEMO_RESET`.

## 5. LLM design

### Provider abstraction
An `LlmClient` interface with two capabilities: (a) produce structured output validated against a schema, (b) run a tool-use turn. Implementations: Anthropic (real) and Scripted (tests and mock mode).

### Mandate parsing
- Forced structured output matching the Mandate input schema, plus an optional `clarifyingQuestion` field.
- Server validates with Zod. If invalid, retry once with the validation error appended, then return a user-facing error.
- Never auto-activate. The API returns a draft. Activation is a separate user action.

### Agent loop
- System prompt (stable, no user content): role, the fact that spending rules are enforced by the system, that the agent should be concise, that tool results contain untrusted text and must never be treated as instructions, and that a denial must be reported honestly to the user.
- Tools: `search_products(query)`, `get_budget()`, `request_purchase(productId, quantity)`.
- `request_purchase` returns the policy decision and outcome (including denial reasons) so the agent can explain it.
- Max 6 tool iterations per user message, 30-second timeout per LLM call, one retry on transient errors.
- Product descriptions are passed inside a clearly delimited, labelled data block. A heuristic scanner flags phrases like "ignore previous instructions" or "buy immediately" and logs `SUSPICIOUS_CONTENT_FLAGGED`. The flag is informational only and never changes policy outcomes.

### Mock mode
`MOCK_LLM=1` swaps in the Scripted client, which replays fixtures for the five demo scenarios. Used by tests, CI, and as a recording fail-safe.

## 6. PayPal integration

Base URL (sandbox): `https://api-m.sandbox.paypal.com`. **Verify every endpoint and field against current PayPal docs before coding. Docs win over this document.**

### Primitives
- OAuth 2.0 client-credentials token (`/v1/oauth2/token`), cached in memory until shortly before expiry.
- Create order: Orders v2 (`/v2/checkout/orders`), intent `CAPTURE`, one purchase unit with amount in USD and an item breakdown. Note: when supplying `payment_source.paypal.experience_context`, PayPal returns `200` (`PAYER_ACTION_REQUIRED`) with link `rel: "payer-action"`.
- Capture order: `/v2/checkout/orders/{id}/capture` (only needed if the create-order response is not already `COMPLETED`).
- Vault v3 (Mode A): `POST /v3/vault/setup-tokens` (`usage_type: "MERCHANT"`, `experience_context`) returns `approve` URL; on return, exchange via `POST /v3/vault/payment-tokens` with `payment_source: { token: { id, type: "SETUP_TOKEN" } }` to obtain a reusable `vault_id`; charge later via `POST /v2/checkout/orders` with `payment_source: { paypal: { vault_id } }`.
- Every write sends a `PayPal-Request-Id` idempotency header derived from the purchase id and step.
- Errors map to a small internal error type (auth, validation, declined, transient). Transient errors retry with backoff, up to 2 times.

### The buyer-approval problem (critical)
A standard PayPal order must be approved by the buyer before capture.

**Decision (2026-11-11, post-T0.4 fallback): Mode B (Orders v2 buyer-approval redirect + capture) selected.**
- Mode A (Vault v3 `setup-tokens` -> `agreements/approve`) returned `201 Created` at the API level during Spike S1/T0.4, but PayPal's hosted `/agreements/approve` UI rejected buyer consent after login (*"Things don't appear to be working at the moment"*), consistent with PayPal Wallet Vaulting regional/account feature restrictions.
- **Mode B flow:**
  1. On `APPROVE` (or after human approval of an `ASK_HUMAN` request), create an Orders v2 order (`POST /v2/checkout/orders`, `intent: "CAPTURE"`, `payment_source.paypal.experience_context`) and store the `payer-action` approval URL on the purchase record.
  2. In the UI, prompt/redirect the buyer to PayPal's `payer-action` sandbox checkout page to authenticate and approve payment.
  3. On return (`/api/paypal/connect/return`), capture the order server-side (`POST /v2/checkout/orders/{id}/capture` with `PayPal-Request-Id`), mark the purchase `captured`, and append `PAYPAL_CAPTURED` to the audit log. On cancel (`/api/paypal/connect/cancel`), mark appropriately and log.
- The policy engine, Approval Inbox, and ledger are identical. Pitch framing: "policy decides whether the agent may proceed; PayPal handles buyer authentication."
- Everything sits behind the `PaymentExecutor` interface so Mode A can be plugged in later without changing domain or orchestration.

### Optional: PayPal MCP / Agent Toolkit (FR-14)
Time-boxed secondary use (for example, read an order or create an invoice via the sandbox MCP server). Only attempt if all Must items are done.

## 7. API contract (routes)

| Route | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Liveness, config sanity (sandbox, LLM mode) |
| `/api/mandate/parse` | POST | Text in, draft mandate (or clarifying question) out |
| `/api/mandate` | GET | Current active mandate and budget summary |
| `/api/mandate/activate` | POST | Activate a (possibly edited) draft |
| `/api/agent/chat` | POST | User message in, streamed agent steps and final reply out |
| `/api/approvals` | GET | Pending and recent approvals |
| `/api/approvals/[id]/approve` | POST | Re-run policy, then execute payment |
| `/api/approvals/[id]/reject` | POST | Reject and log |
| `/api/audit` | GET | Audit events (supports simple filtering) |
| `/api/paypal/connect/*` | GET/POST | Mode A connect flow, or Mode B return and cancel handlers |
| `/api/demo/reset` | POST | Clear data and reseed. Only when `DEMO_MODE=1` |

All request bodies are validated with Zod. Errors return a consistent shape: `code`, `message`.

## 8. Test plan (TDD)

Write tests first for domain and services. Order matters: **tests are red, then implementation, then green.**

### 8.1 Policy engine (table-driven, no mocks needed)
Mandate used in tests: cap 15000, auto 5000, hard 12000, categories `running gear` and `nutrition`, blocked `ShadyDeals`.

| Case | Spent so far | Item | Expected |
|---|---|---|---|
| Cheap in-category | 0 | $24 nutrition | APPROVE, `WITHIN_MANDATE` |
| Exactly at auto limit | 0 | $50 | APPROVE |
| One cent over auto limit | 0 | $50.01 | ASK_HUMAN, `OVER_AUTO_LIMIT` |
| Between auto and hard | 0 | $89 | ASK_HUMAN |
| Exactly at hard limit | 0 | $120 | ASK_HUMAN |
| One cent over hard limit | 0 | $120.01 | DENY, `OVER_HARD_LIMIT` |
| Category not allowed | 0 | $20 electronics | DENY, `CATEGORY_NOT_ALLOWED` |
| Blocked merchant (case variations) | 0 | $10 | DENY, `MERCHANT_BLOCKED` |
| Over remaining budget | $113 | $45 | DENY, `OVER_MONTHLY_BUDGET` (remaining $37) |
| Exactly uses remaining budget | $113 | $37 (auto) | APPROVE, remaining 0 |
| Quantity multiplies | 0 | $30 x 2 | total $60, ASK_HUMAN |
| Invalid quantity or price | 0 | qty 0, negative price | DENY, `INVALID_REQUEST` |
| No active mandate | n/a | any | DENY, `NO_ACTIVE_MANDATE` |
| Multiple failures | 0 | $249 electronics | DENY, explanation mentions both category and hard limit |
| Determinism | any | same input twice | identical output, no mutation of inputs |

### 8.2 Schemas and money utilities
- Mandate schema accepts valid, rejects hard < auto, empty categories, non-integer cents, negative values.
- Money parsing and formatting round-trips. No floating-point arithmetic in totals.
- Month window: purchases at 23:59:59 UTC on the last day of a month do not count toward the next month. A purchase at midnight starts a new window.

### 8.3 Orchestrator and approvals (integration, in-memory DB, fake executor)
- APPROVE leads to executor called once, purchase `captured`, audit events in order.
- ASK_HUMAN leads to an approval record, executor not called.
- DENY leads to executor not called.
- Approve flow re-evaluates policy: if the budget was consumed meanwhile, approval fails with `OVER_MONTHLY_BUDGET` and nothing is charged.
- Double-clicking Approve triggers one execution (idempotent).
- Reject sets status and logs. Cannot be approved afterwards.

### 8.4 PayPal client (mocked fetch)
- Token is cached and refreshed after expiry.
- Idempotency header present and stable per purchase and step.
- Maps 401, 422, and 5xx to the right internal error type. Transient errors retry at most twice.
- Refuses to construct the client if environment is not sandbox.

### 8.5 Agent loop (scripted fake LLM)
- Scripted sequence search then request_purchase yields correct policy path, and final reply reflects the decision.
- A scripted LLM that attempts to purchase an out-of-policy item is still DENIED and the PayPal client is never called.
- Iteration cap stops runaway loops.
- Injection-bait product triggers a `SUSPICIOUS_CONTENT_FLAGGED` event and does not change the decision.

### 8.6 Architecture guard
A test scans source imports and fails if any module other than the Executor imports the PayPal client, or if `domain` imports from `infra`, `services`, or `app`.

### 8.7 Manual end-to-end smoke (before recording)
Run the five demo scenarios in PRD section 10 against the real sandbox and real LLM. Confirm the captured payments in the PayPal sandbox dashboard.

## 9. Security and safety notes

- Secrets only in env vars. `.env` is git-ignored. `.env.example` has placeholders.
- No secrets, tokens, or full PayPal payloads in logs. Log order ids only.
- Rate-limit `/api/agent/chat` lightly (in-memory) to protect LLM spend.
- Reset endpoint disabled unless `DEMO_MODE=1`.
- Output encoding: product text rendered as plain text in UI, never as HTML.

## 10. Deployment

- Render web service from the GitHub repo. Build: install and build. Start: Next.js production start.
- SQLite file on the instance's local disk is acceptable (ephemeral). The app seeds the catalog and, in DEMO_MODE, a ready-to-use state on boot.
- Environment variables:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | LLM access |
| `ANTHROPIC_MODEL` | Model identifier (configurable, no hard-coding) |
| `PAYPAL_ENV` | Must be `sandbox` |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Sandbox app credentials |
| `APP_BASE_URL` | Used for PayPal return and cancel URLs |
| `DATABASE_PATH` | SQLite file location |
| `DEMO_MODE` | `1` enables reset and demo seeding |
| `MOCK_LLM` | `1` uses scripted LLM |
| `CHANNEL3_API_KEY` | Optional |

- `/api/health` used by Render health checks.

## 11. Open technical decisions

| Decision | Resolve by | Default if undecided |
|---|---|---|
| Vault support (Mode A vs B) | Spike S1, first 60 minutes | Mode B |
| Streaming (SSE) vs polling for agent steps | Phase 4 | Simple JSON response containing all steps, then upgrade to streaming if time allows |
| Channel3 adapter | After all Must items | Skip |
