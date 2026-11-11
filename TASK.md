# TASK.md: Work plan

Check items off as they are completed. Work in order. Do not start a phase until the previous phase's **checkpoint** passes.

**Schedule**
- **Day 1 (Nov 10):** Phases 0 to 4. Goal: working end-to-end flow, even if ugly.
- **Day 2 (Nov 11):** Phases 5 to 7. Goal: polished, deployed, recorded, submitted by evening.
- **Feature freeze:** Nov 11, midday. After this, only fixes, README, video, and submission.
- **Hard deadline:** Nov 12, 12:00 pm PT. Never plan to use the last day.

**Cut order if behind (cut from the top first):** FR-14 MCP, FR-13 Channel3, streaming, injection flagging UI polish, ledger filters, Mode A (use Mode B), mock-LLM fixtures beyond the five scenarios.

---

## Phase 0: Setup and spikes (about 2h)

- [x] **T0.1 Repo scaffold (30m).** Next.js + TypeScript strict + Tailwind + Vitest + Zod + ESLint. MIT `LICENSE`, `.gitignore` (includes `.env`), `.env.example` listing every variable in TDD section 10, empty README skeleton, docs copied into `docs/`.
  - *Accept:* `npm install`, `npm run dev`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` all succeed on a clean clone.
- [x] **T0.2 Spike S1: PayPal sandbox feasibility (60m max).** Using the current PayPal docs, with the user's sandbox credentials in `.env`:
  1. Obtain an access token.
  2. Create a sandbox order.
  3. Determine whether a **vaulted payment token** flow (Mode A) can be completed with the sandbox buyer account so an order can be captured server-side without buyer interaction.
  4. Determine the minimum steps for Mode B (approve redirect, then capture).
  - *Accept:* a short written report in `docs/SPIKE_S1.md` (what worked, exact endpoints used, blockers, recommendation). **Stop and report to the user before continuing.**
- [x] **T0.3 Spike S2: LLM connectivity (15m).** Confirm the configured model works for (a) structured output and (b) tool use. Report the model name in use.
  - *Accept:* one successful call for each, noted in `docs/SPIKE_S1.md` (append).

**Checkpoint 0:** scaffold builds. S1 decision (Mode A or B) is agreed with the user.

---

## Phase 1: Domain core (TDD) (about 3h)

- [ ] **T1.1 Money utilities.** Integer cents parse and format, safe arithmetic helpers. *Accept:* tests in TDD 8.2 pass.
- [ ] **T1.2 Schemas and types.** Mandate, Product, PurchaseRequest, PolicyContext, PolicyDecision. *Accept:* schema tests in TDD 8.2 pass.
- [ ] **T1.3 Policy engine.** Implement TDD section 4 evaluation order. *Accept:* **all** cases in TDD 8.1 written first, seen failing, then passing. Determinism test included.
- [ ] **T1.4 Month window helper.** UTC calendar month boundaries, `now` injected. *Accept:* boundary tests in TDD 8.2 pass.

**Checkpoint 1:** `npm test` green. Policy engine has no imports from outside `domain`.

---

## Phase 2: Persistence and orchestration (about 3h)

- [ ] **T2.1 Database layer.** SQLite schema for mandates, purchases, approvals, audit_events. Migrations run on boot. Audit log has insert and read only. *Accept:* repository tests with an in-memory DB.
- [ ] **T2.2 Audit service.** Typed event creation, written in the same transaction as the state change. *Accept:* ordering test.
- [ ] **T2.3 Product catalog and provider.** `src/data/products.json` with about 24 products across running gear, nutrition, and a few off-category items. Must include: gels at $24, trail running shoes at $89, a GPS watch at $249 (electronics), one item from merchant `ShadyDeals`, a headlamp whose description contains injection-bait text, and a $45 hydration vest. A `ProductProvider` interface and the local implementation with keyword search. *Accept:* search tests.
- [ ] **T2.4 Executor interface and fake.** `PaymentExecutor` interface plus an in-memory fake for tests. *Accept:* interface documented in TDD terms.
- [ ] **T2.5 Purchase orchestrator.** Policy then audit then (APPROVE: execute, ASK_HUMAN: create approval, DENY: stop). *Accept:* TDD 8.3 tests (first three bullets) pass.
- [ ] **T2.6 Approval service.** Approve (re-evaluate policy, idempotent), reject. *Accept:* remaining TDD 8.3 tests pass.

**Checkpoint 2:** all orchestration works with the fake executor. Tests green.

---

## Phase 3: PayPal executor (about 3h)

- [ ] **T3.1 PayPal client.** Token cache, create order, capture, idempotency header, error mapping, sandbox guard. *Accept:* TDD 8.4 tests pass with mocked fetch.
- [ ] **T3.2 Executor implementation** for the mode chosen in S1. 
  - Mode A: connect flow (setup token, payment token), server-side create and capture with the saved token.
  - Mode B: create order, approval redirect, return and cancel handlers, capture on return.
  - *Accept:* a real sandbox purchase is captured end-to-end and visible in the PayPal sandbox dashboard. Order id appears in the audit log.
- [ ] **T3.3 Architecture guard test.** TDD 8.6. *Accept:* test fails if a forbidden import is introduced (verify by temporarily adding one).

**Checkpoint 3:** one real sandbox payment succeeds through the orchestrator.

---

## Phase 4: LLM services and API (about 4h)

- [ ] **T4.1 LlmClient interface, Anthropic implementation, Scripted implementation.** *Accept:* contract tests run against Scripted. Anthropic verified manually.
- [ ] **T4.2 Mandate parser service.** Structured output, Zod validation, one retry, clarifying question support. *Accept:* tests with Scripted client for valid, invalid-then-valid, and ambiguous inputs. Manual check with the demo mandate text from PRD section 10.
- [ ] **T4.3 Agent service.** Tool-use loop with the three tools, iteration cap, untrusted-content wrapping, injection flagging. *Accept:* TDD 8.5 tests pass.
- [ ] **T4.4 API routes.** All routes in TDD section 7 with Zod validation and consistent errors. Health endpoint reports sandbox status and LLM mode. *Accept:* route tests for happy path and one failure path each.
- [ ] **T4.5 Demo seed and reset.** `DEMO_MODE` seeding and `/api/demo/reset`. *Accept:* reset returns the app to a clean state in under 2 seconds.
- [ ] **T4.6 Mock-LLM fixtures** for the five PRD demo scenarios. *Accept:* with `MOCK_LLM=1`, all five scenarios produce the expected decisions via the API.

**Checkpoint 4 (end of Day 1 target):** with curl or a REST client, the full flow works: parse mandate, activate, chat, approve, see the audit log. Commit and push.

---

## Phase 5: UI (about 4h, Day 2 morning)

- [ ] **T5.1 App shell and layout.** One page with Mandate panel, Agent chat, Approval Inbox, and Ledger tab. Clean, readable, responsive down to a laptop screen.
- [ ] **T5.2 Mandate panel.** Text input, Parse, rule preview with editable fields and warnings, Activate, clarifying-question display.
- [ ] **T5.3 Budget meter.** Spent, pending, remaining, updated after every purchase.
- [ ] **T5.4 Agent chat.** Messages plus visible agent steps (searching, found, requesting, decision). Decision chips: green approved, amber needs approval, red denied, each with the plain-language reason and numbers.
- [ ] **T5.5 Approval Inbox.** Pending items with product, price, triggering rule, Approve and Reject. Handles the Mode A or Mode B payment step.
- [ ] **T5.6 AG Grid ledger.** Columns: time, event type, actor, product, amount, decision, reason, PayPal order id. Sorting and a quick filter. Row styling by event type.
- [ ] **T5.7 Empty, loading, and error states.** Friendly messages. No raw errors.
- [ ] **T5.8 Demo mode touches.** Reset button, one-click "Try: ..." example prompts for the five scenarios.

**Checkpoint 5:** all five demo scenarios run in the UI against the real sandbox and real LLM, start to finish.

---

## Phase 6: Deployment and docs (about 2h)

- [ ] **T6.1 Deploy to Render.** Environment variables set, `APP_BASE_URL` correct for PayPal return URLs, health check configured. *Accept:* the hosted URL completes scenario 1 and scenario 2 end-to-end.
- [ ] **T6.2 README.** Elevator pitch, screenshot or GIF, architecture diagram (from TDD), 5-step setup, how to get PayPal sandbox credentials and test buyer account, how to run in mock mode, tests, tools used and how, license, hosted URL.
- [ ] **T6.3 Clean-clone test.** Clone the repo to a new folder and follow the README exactly. *Accept:* works with no undocumented steps.
- [ ] **T6.4 Repo hygiene.** MIT license visible in the GitHub About section, repo public, no secrets in history (check git history), topics and description set.

**Checkpoint 6:** a stranger could run it. Hosted demo works.

---

## Phase 7: Video and submission (about 3h)

- [ ] **T7.1 Rehearse** the five scenarios twice end-to-end. Reset between runs.
- [ ] **T7.2 Record** the demo video per PRD section 10 (target 2:30, hard max 2:59). Screen capture of the working app, clear voice, no copyrighted music, no third-party logos beyond what is naturally visible in the PayPal sandbox UI. Use the real stack, with mock mode only as a fallback.
- [ ] **T7.3 Upload** to YouTube as public. Verify it plays logged out.
- [ ] **T7.4 Devpost submission text.** Features and functionality, tools used and how (LLM for mandate parsing and agent; PayPal REST sandbox for orders and capture; AG Grid for ledger; Render for hosting), what is new and what was built during the hackathon, how to run and test, test credentials note.
- [ ] **T7.5 Submit** on Devpost. Open the submitted page in a private window and verify the repo link, video link, and demo URL all work.

**Final checkpoint:** submitted by the evening of Nov 11. Nov 12 is buffer only.

---

## Submission verification checklist

- [ ] Repo public, MIT license visible in About
- [ ] README setup works from a clean clone
- [ ] Hosted demo URL live (warmed up before judging)
- [ ] Video under 3:00, public on YouTube, link on the form
- [ ] Description names every tool and how it was used
- [ ] No secrets in repo or git history
- [ ] Submission confirmed in Devpost
