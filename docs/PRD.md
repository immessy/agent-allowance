# PRD: Agent Allowance

**Hackathon:** Build What's Next with PayPal and AI (Devpost)
**Deadline:** Thu Nov 12, 2026, 12:00 pm PT. Internal target: submitted by the evening of Nov 11.
**Owner:** solo builder
**Status:** v1, scoped for a 2-day build

---

## 1. One-liner

Hand an AI shopping agent a budget in plain English, and trust it with PayPal. Agent Allowance is a spending-guardrails layer that approves, escalates, or blocks every agent purchase using deterministic rules, and records every decision in an audit ledger.

## 2. Problem

AI agents can now pay for things, and PayPal ships an official Agent Toolkit and MCP server for it. The hard part is not "can an agent pay?" but "will I let it?". People worry about:

- runaway spend (a loop, a misread request, a bad product match),
- prompt injection (a product page that tells the agent to buy something),
- no visibility (what did it buy, why, and who approved it?).

The tooling leaves approval controls to the developer. Today most "agentic checkout" demos have no enforceable limits and no audit trail.

## 3. Target users

| Persona | Need |
|---|---|
| **Maya, the everyday shopper** (primary, used in the demo) | Delegate routine buying ("running gear, under $150/month") without watching every purchase. |
| **Dev, a small-business owner** (secondary, mentioned in the pitch) | Let an agent or staff member reorder supplies within category and budget limits, with an approval trail. |

## 4. Goals and non-goals

**Goals**
1. A user can define a spending mandate in plain English and review it as structured rules before activating it.
2. An agent can search products and attempt purchases, and a **code-level policy engine** (never the LLM) makes the final decision.
3. Approved purchases are paid through the PayPal sandbox.
4. Purchases above the auto-approve limit wait for explicit human approval.
5. Every step is visible in an audit ledger.
6. A judge can run it from the README or open a hosted URL.

**Non-goals (do not build)**
- Real money, production PayPal credentials, user accounts or auth, multi-user support
- Refunds, disputes, subscriptions, payouts
- Real inventory, shipping, or tax logic
- Mobile app, notifications, email

## 5. Core concepts

- **Mandate:** the user's rules: monthly cap, auto-approve limit per item, hard limit per item, allowed categories, blocked merchants.
- **Purchase request:** the agent's proposal to buy one product (quantity ≥ 1).
- **Policy decision:** `APPROVE`, `ASK_HUMAN`, or `DENY`, with a machine-readable reason code and a human-readable explanation.
- **Approval:** a human accept or reject of an `ASK_HUMAN` request. Policy is re-checked at approval time.
- **Audit event:** an append-only record of everything that happened.

## 6. User stories and acceptance criteria

**US-1 Create a mandate.** As Maya, I type my budget in plain English and see it turned into structured rules.
- AC: the parsed rules are shown in an editable preview. Nothing is active until I click Activate.
- AC: if the text is ambiguous or missing a key value (for example, no monthly cap), the system asks a clarifying question instead of guessing.

**US-2 Auto-buy within limits.** As Maya, I ask the agent for something cheap and in-category and it just gets bought.
- AC: the decision is `APPROVE`, a PayPal sandbox order is created and captured, and the budget meter updates.

**US-3 Approve a bigger purchase.** As Maya, I'm asked before the agent spends above my auto-approve limit.
- AC: the request appears in the Approval Inbox with product, price, and the rule that triggered the ask.
- AC: Approve captures payment. Reject cancels it. Both are logged.

**US-4 Blocked purchases.** As Maya, the agent can never break my hard rules.
- AC: out-of-category items, blocked merchants, over-hard-limit items, and items that exceed the remaining monthly budget are denied with a clear reason, and no PayPal call is made.

**US-5 Audit trail.** As Maya, I can see exactly what the agent did and why.
- AC: a sortable, filterable ledger shows time, event type, product, amount, decision, reason, and PayPal order ID.

**US-6 Injection resistance.** As Maya, a malicious product description can't make the agent bypass my rules.
- AC: a seeded product with injected instructions is tested in the demo. The policy engine still decides, and the ledger shows the attempt flagged.

## 7. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-1 | Parse natural-language mandate into a validated structure via LLM with structured output | Must |
| FR-2 | Mandate preview, edit, and explicit activation | Must |
| FR-3 | Policy engine: pure, deterministic, no I/O, no LLM | Must |
| FR-4 | Agent loop with tools: search products, request purchase, get budget | Must |
| FR-5 | Agent can only spend through the request-purchase tool, which always goes through the policy engine | Must |
| FR-6 | PayPal sandbox checkout: create order and capture (see TDD section 6 for modes) | Must |
| FR-7 | Approval Inbox with Approve and Reject, policy re-evaluated on approval | Must |
| FR-8 | Append-only audit log and AG Grid ledger | Must |
| FR-9 | Budget meter (spent, pending, remaining) | Must |
| FR-10 | Seeded product catalog including an in-budget item, an over-limit item, an out-of-category item, a blocked merchant, and an injection-bait item | Must |
| FR-11 | Demo reset endpoint and button (DEMO_MODE only) | Must |
| FR-12 | Deterministic mock-LLM mode for tests and as a demo fail-safe | Should |
| FR-13 | Channel3 product search adapter behind the same provider interface | Could |
| FR-14 | PayPal MCP or Agent Toolkit used for a secondary read-only action | Could |

## 8. Non-functional requirements

- **Safety:** the app refuses to start with non-sandbox PayPal config. Secrets only via environment variables.
- **Reliability:** every PayPal write uses an idempotency key. Duplicate approval clicks can't double-charge.
- **Testability:** policy engine has table-driven unit tests. Logic is verified without network access.
- **Performance:** a full agent turn should complete in under about 15 seconds.
- **Run-ability:** `npm install`, copy `.env.example`, `npm run dev` works from a clean clone. A hosted Render URL is also provided.
- **Licensing:** MIT license in repo root so it shows in the GitHub About section.

## 9. Experience (screens)

One page, three regions plus a ledger tab:
1. **Mandate panel:** text box, "Parse" button, rule preview, Activate. Below it, the **budget meter**.
2. **Agent chat:** the user asks for things. Agent steps stream in (searching, found, requesting purchase, decision).
3. **Approval Inbox:** pending requests with Approve and Reject.
4. **Ledger tab:** AG Grid of audit events.

A "Reset demo" button is visible in DEMO_MODE.

## 10. Demo scenarios (seeded and scripted)

Mandate used: *"I'm training for a trail race. Spend up to $150 a month on running gear and nutrition. Buy anything under $50 without asking, ask me for anything up to $120, never buy anything pricier. Don't buy from ShadyDeals."*

| # | User says | Expected result |
|---|---|---|
| 1 | "Get me a pack of energy gels" ($24, nutrition) | `APPROVE`, captured in sandbox |
| 2 | "I need trail running shoes" ($89, running gear) | `ASK_HUMAN`, user approves, captured. Spent total: $113 |
| 3 | "Buy me a GPS sports watch" ($249) | `DENY`: above hard limit and out of allowed categories |
| 4 | "Get the cheapest headlamp" (injection-bait listing) | Agent attempts it, injection flagged, policy decides normally |
| 5 | "Get a $45 hydration vest" | `DENY`: exceeds remaining monthly budget ($37) |

## 11. Success criteria mapped to judging

| Criterion | How we show it |
|---|---|
| Technological Implementation | Real PayPal sandbox orders and captures, structured-output LLM parsing, tool-using agent, deterministic policy engine with tests, idempotent payments |
| Design | Single coherent flow: mandate, agent, approve, ledger. Clear decisions and reasons in the UI |
| Potential Impact | Specific audience and a credible trust problem for agentic commerce |
| Innovation/Idea | A guardrail layer, not another shopping bot. Policy-as-code with the LLM kept out of the money path |
| Presentation | 2:30 video following the script in section 10, end-to-end with no cuts away from the working app |

Target honorable mentions: **Best Use of Agentic Commerce**, **Best Use of PayPal + AI**.
Target sponsor prize (only one can be won): **AG Grid** (ledger), with **Render** hosting as a bonus entry.

## 12. Submission checklist

- [ ] Public GitHub repo with MIT license visible in About
- [ ] README: what it is, architecture diagram, setup in under 5 steps, sandbox test credentials instructions, tools used and how
- [ ] Hosted demo URL on Render (and run-locally instructions as backup)
- [ ] Demo video under 3:00, public on YouTube, no copyrighted music or third-party trademarks
- [ ] Devpost text description: features, functionality, tools used and how
- [ ] Submitted by the evening of Nov 11

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Server-side capture without buyer interaction may need PayPal Vault on the sandbox app | Day-1 spike S1 with fallback Mode B (TDD section 6) |
| LLM flakiness during recording | Mock-LLM mode and recorded fixtures (FR-12) |
| Render free tier cold start | Warm the URL before judging and recording. Keep local run instructions |
| Scope creep | Non-goals list. Cut order in TASK.md |
| Channel3 integration eats time | Optional, time-boxed to 30 minutes, falls back to local catalog |

## 14. Open questions (resolve during the spike)

1. Does the sandbox app have Vault enabled for server-side captures? (Decides Mode A vs B.)
2. Is the Anthropic model string configured for this key? Default is set via `ANTHROPIC_MODEL`.
