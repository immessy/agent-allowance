# Agent Allowance

A spending-guardrails layer for AI shopping agents using a deterministic policy engine, the PayPal sandbox, and an audit ledger.

## Status

Scaffolding in progress (Phase 0). See [TASK.md](TASK.md), [docs/PRD.md](docs/PRD.md), and [docs/TDD.md](docs/TDD.md).

## Local setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in your PayPal sandbox and Anthropic API credentials (`PAYPAL_ENV=sandbox`).
3. Run the development server:
   ```bash
   npm run dev
   ```

## Commands

- `npm install` — Install dependencies locally in `./node_modules`
- `npm run dev` — Start the Next.js development server
- `npm test` — Run Vitest unit and integration tests
- `npm run typecheck` — Run TypeScript strict type checking
- `npm run lint` — Run ESLint
- `npm run build` — Create production build
- `npm start` — Start production server

## License

MIT

