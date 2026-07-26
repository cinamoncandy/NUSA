# DOKKAEBI

AI-Assisted Investment Operating System (private, single-user)

This file merges the original project charter with a newer, stricter charter the owner
provided later. Where they agree, they are stated once. Where the newer charter describes a
target this codebase has not reached yet, that is marked explicitly rather than implied. This
file is intentionally honest about gaps -- claiming compliance that does not exist would violate
the charter's own "Trust over Profit" and "Explain Everything" principles.

## Mission

DOKKAEBI is not an automated trading bot. It is an AI-assisted investment operating system
focused on safety, transparency, and explainability, built to maximize (in this order):

1. safety and capital survival,
2. long-term risk-adjusted profit,
3. efficiency,
4. convenience.

Profit is important. Trust is mandatory.

The first market is Upbit spot. Binance futures is a later phase and stays out of scope until
the Upbit spot system has passed backtest, walk-forward, paper-trading, recovery, and
risk-control gates.

## Product principles

1. Safety First
2. Human In Control
3. Mobile First
4. Explain Everything
5. Trust over Profit

## Non-negotiable principles

- Evidence before confidence.
- Capital survival before return maximization.
- Paper before live.
- Risk may veto every trade -- even the Owner cannot bypass the Risk Engine.
- No strategy is trusted permanently.
- Every meaningful feature must improve profit potential, safety, efficiency, or convenience.
- No API key, secret, credential, or private operating data may be committed.
- Live trading requires explicit owner approval and dedicated safety controls.
- AI never submits orders. AI only creates proposals (see "AI rules" below).

## Priority order

Correctness > Safety > Reliability > Maintainability > Performance > Convenience.

## Target architecture

```text
Mobile
  -> Control API
  -> Application Layer
  -> Domain Layer
  -> Infrastructure Layer
  -> Exchange
```

Never bypass this layering. It replaces (does not contradict) the original layered flow this
project also used to describe the same boundary discipline:

```text
Market Data -> Intelligence -> Strategy -> Decision -> Risk
  -> Portfolio / Capital Allocation -> Execution -> Paper or Live Adapter -> Review -> Memory / Research
```

### Boundaries

- Strategy produces signals, not exchange orders.
- Decision combines strategy, market regime, account state, and policy.
- Risk can reject, resize, or halt any decision. It cannot be bypassed -- not by UI, not by
  strategy, not by automation, not by exchange adapters, not by the Owner.
- Execution does not know strategy internals.
- Exchange-specific behavior belongs behind adapters.
- Paper and live execution should share contracts while remaining operationally isolated.
- Electron renderer must not receive Node.js or credential access.

## AI rules

- AI never submits orders. AI only creates proposals.
- Execution Manager is the only component allowed to communicate with the Trading Engine.
- Workflow: `AI -> Proposal -> Risk Engine -> Approval -> Execution Manager -> Trading Engine`.
- AI may answer "I don't know." Low confidence should recommend **NO TRADE** instead of guessing.
- Treat AI output as untrusted advice until validated by deterministic controls.

**Status: not built yet.** No proposal/approval layer exists today. The current automatic
pipeline (`apps/server/src/pipeline/automaticTradingPipeline.ts`) runs a deterministic
SMA/EMA crossover strategy straight through the Risk Engine to the broker -- no AI makes a
trading decision anywhere in this codebase today. The "AI CIO" dashboard already follows this
charter's spirit in one respect: `committee`/`research` sections honestly report
`SOURCE_NOT_CONNECTED` rather than fabricating a recommendation (see
`apps/desktop/src/paperDashboardProjection.ts`). Building a real proposal -> approval workflow is
future, scoped work, not implied by anything currently running.

## Financial rules

- Never use float. Use Decimal.
- Ledger must be immutable. Never modify the Ledger directly -- corrections are append-only
  events.
- Deterministic accounting and idempotency must be preserved.

**Status: not compliant yet, and this is the single largest known gap against this charter.**
Every numeric price/quantity/cash value across `packages/core`, `apps/server`, and
`apps/desktop` is a plain JS `number` (float) today -- across 1200+ tests and every money-moving
module. Migrating to a Decimal type is a real, breaking, repo-wide change that was deliberately
**not** attempted in one unreviewed pass: the blast radius (every arithmetic call site, every
test's expected values, every persisted/serialized number) is exactly the kind of hard-to-reverse
change that needs a staged plan and explicit owner sign-off on the approach (which Decimal
library or hand-rolled fixed-point representation, how existing SQLite-persisted float data
migrates, how JSON API responses represent it), not a unilateral rewrite. Tracked as the top
open item until that plan exists.

What *is* already true: `packages/core`'s reference Portfolio/PnL ledger
(`packages/core/src/portfolio/portfolio.ts`) is already audit-only and never mutated in place --
every update returns a new ledger via a discriminated-union result, and it is never read back
into a trading decision. It just isn't Decimal-typed yet, and it isn't the full
correction-event-sourced Ledger this charter describes.

## Risk rules

- Every order must pass the Risk Engine.
- The Risk Engine cannot be bypassed -- not even by the Owner.

**Status: true today.** `packages/core/src/risk/riskEngine.ts` and PaperBroker's own
`PaperRiskPolicy` both check every order; `apps/server`'s automatic pipeline runs both the
desktop broker's real risk policy (blocking) and the value-based `RiskEngine`/`OrderPlanner`
audit estimate on every tick, and manual orders go through the same broker path -- there is no
code path that places an order without it.

## Recovery rules

Never resume trading automatically before recovery is completed. Recovery order:

```text
Database -> Exchange -> Ledger -> Position -> Market Data -> Safe State
```

**Status: partially true.** `apps/desktop/src/desktopPersistenceStore.ts`'s restore-on-startup
already fails closed (a corrupted/unreadable database leaves Paper trading unavailable rather
than guessing at state -- see `RuntimeCommandService`'s `PERSISTENCE_REPAIR_MESSAGE`), and
automatic trading already defaults to disabled after a fresh install or an ambiguous recovery.
What is **not** built: an explicit, staged recovery sequence matching the exact
Database/Exchange/Ledger/Position/Market-Data/Safe-State order above with its own tests
("Recovery Engine 고도화" from the owner's own roadmap notes) -- today recovery is "load what
SQLite has, or fail closed," not a multi-stage verified sequence.

## Security rules

- API keys never leave the server.
- Mobile never stores exchange credentials.
- Use Device Trust.
- Use biometric authentication for critical commands.

**Status: partially true, partially not built.** No live exchange credentials exist anywhere in
this codebase at all (Paper-only, by design -- there is nothing to leak). The single-user web
app added this session has an *optional* shared-secret API key (`apps/server/src/apiAuth.ts`,
`DOKKAEBI_API_KEY`) and optional self-signed HTTPS (`scripts/generate-dev-cert.js`) -- deliberately
simple, since the owner chose "shared secret" over a full login system when asked. Device Trust
and biometric authentication (WebAuthn or equivalent) are **not implemented** -- there is no
native mobile app, only a responsive PWA, and no per-device trust registry.

## Kill Switch

Kill Switch must always work. Priority: **Kill Switch > Trading > UI**.

**Status: true today.** `apps/desktop/src/controlPlane.ts`'s kill switch (`stop()`/fault
handling) already takes priority over trading -- `RuntimeCommandService` disables auto-trading
and halts the strategy on a fault before anything else, and `"kill switch did not reach a safe
stopped state"` is itself a translated, surfaced error rather than a silent failure.

## Mobile philosophy

Desktop = Research. Mobile = Operations. The mobile app is the primary interface.

**Status: partially true.** This session ran an explicit mobile-focused pass on the web app:
PWA installability (`apps/web/manifest.json`, `apps/web/sw.js`), safe-area handling for
notched/standalone display, every touch target at >=44px, Screen Wake Lock, and iOS
zoom-on-focus prevention (16px inputs) -- all verified against real Playwright sessions at
iPhone SE/13 viewports and landscape. What this is **not**: a native mobile app with Device Trust
or biometric auth, and "mobile as the primary interface" is aspirational -- the Electron desktop
app (`apps/desktop`) and this web app are both still browser/desktop-class surfaces today, not a
dedicated mobile-first product.

## Coding rules

- No `any`.
- No `console.log`.
- Use `Result<T,E>` (discriminated unions), not exceptions, for domain failures.
- Use a structured Logger.
- Write tests first.
- Keep changes small, reviewable, and reversible.
- Add or update tests for every behavior change.
- Prefer explicit domain types over loosely shaped objects.
- Do not add dependencies without a clear need and license review.
- Do not claim tests passed unless they were actually run or CI confirms it.

**Status, checked honestly rather than assumed:** `apps/server/src` and `packages/core/src`
(everything built this session) have zero `console.log`/`console.warn`/`console.error` calls and
zero explicit `any` usage, confirmed by a direct grep, not assumption. `packages/core` already
returns `Result`-style discriminated unions (`{ status: "CALCULATED" | "FAILED", ... }` and
siblings) rather than throwing for domain failures. `apps/server`/`apps/desktop`, by contrast,
*do* throw for domain/validation failures (caught at the HTTP boundary and translated to Korean
via `apps/server/src/errorMessages.ts`) -- a deliberate, existing convention for that layer, not
an oversight, but it does not match "use `Result<T,E>`" read as a repo-wide rule. Reconciling
that is a real design decision (wrap every `apps/server` route in Result instead of try/catch),
not something to silently change branch-wide.

"Write tests first" (strict TDD) has **not** been this session's practice -- the actual practice
has been implement, compile, test immediately after, verify live (browser/curl/real server),
then commit, every single change, with zero exceptions across 1200+ tests. That is rigorous, but
it is not test-first. Not correcting history; correcting habit going forward is a real,
adoptable change.

A structured `Logger` with `requestId`/`commandId`/`userId`/`deviceId` on every command (see
"Logging" below) now exists (`apps/server/src/logger.ts`), alongside `ControlPlane`'s
pre-existing event log (`id`/`type`/`message`/`timestamp`, translated to Korean, exported as
CSV) -- the two are complementary, not a replacement: `ControlPlane`'s log is the trading-domain
audit trail, `Logger`'s is the HTTP-request audit trail.

## Logging

Every command requires `requestId`, `commandId`, `userId`, `deviceId`. Audit all critical
operations.

**Status: built.** `apps/server/src/logger.ts`'s `Logger` writes one structured JSON line per
HTTP request to stdout (never `console.log`) and keeps a bounded 500-entry in-memory tail,
readable live via `GET /api/audit/requests` (itself a normal `/api/` route -- subject to the
same rate limiting and optional API-key auth as everything else). Every request gets a
`requestId`; every state-changing (non-`GET`) request also gets a `commandId` (a `GET` is a
read, not a command); `userId` is always `"operator"` -- honest, since this is a single-user
system with no per-user accounts, not a fabricated multi-user concept; `deviceId` comes from the
client's `X-Device-Id` header (`apps/web/app.js` generates one UUID per browser on first load
and persists it in `localStorage`, sending it on every request) and is absent, never invented,
for callers that don't send one (curl, tests).

## AI confidence

AI may answer "I don't know." Low confidence should recommend **NO TRADE** instead of guessing.

**Status: not applicable yet** -- no AI makes trading decisions in this codebase today (see "AI
rules" above), so there is no confidence signal to calibrate. The principle is already honored in
spirit by the AI CIO dashboard reporting `SOURCE_NOT_CONNECTED` rather than fabricating.

## Testing

Unit, Integration, E2E, Burn-in, Recovery. No feature is complete without tests.

**Status: Unit and Integration exist extensively (1200+ tests, `node --test`, no CI runner in
this sandbox -- see AGENTS.md and the implementation docs for why `pnpm install` cannot complete
here). E2E exists as manual Playwright sessions run during development, not a checked-in
automated E2E suite. Burn-in (long-duration soak runs) and a dedicated Recovery test suite (see
"Recovery rules" above) do not exist yet.**

## Performance targets

Dashboard < 1s, API < 200ms, Kill Switch < 500ms, Recovery < 60s.

**Status: not formally benchmarked against these exact targets.** `scripts/performance-baseline.js`
measures P50/P95/P99 for the hot paths that exist (order processing, market data mapping, SQLite
writes, champion-system ticks, backtest runs) in this sandbox's own hardware, which is explicitly
documented there as not representative of a real deployment -- see that script's own doc comment.
None of it has been mapped onto these four specific named targets yet.

## Security rules (commit hygiene)

- No API key, secret, credential, or private operating data may be committed.
- Never change repository visibility, delete branches, rewrite shared history, or remove
  production data without explicit approval.

## Engineering rules

- Keep changes small, reviewable, and reversible.
- Avoid hidden global state and implicit side effects.
- Validate all IPC and external data at trust boundaries.
- Do not add dependencies without a clear need and license review.

## Trading research rules

- Do not promote a strategy based only on in-sample backtests.
- Include fees, slippage, latency assumptions, and missing-data behavior.
- Require out-of-sample or walk-forward evidence before paper promotion.
- Require paper evidence before live-candidate status.
- Track regime sensitivity, drawdown, exposure, turnover, and parameter stability.

## Pull request checklist

- Build passes
- Tests pass
- Typecheck passes
- Lint passes
- Documentation updated
- Audit impact reviewed

## Never do

- Never bypass the Risk Engine.
- Never edit the Ledger directly.
- Never allow AI to execute trades.
- Never expose API keys.
- Never remove audit logs.
- Never deploy untested code.
- Never enable live trading without explicit owner approval.
- Never commit API keys, secrets, tokens, credentials, account identifiers, or private trading
  data.

## Current scope

### Active

- Electron Windows desktop app (`apps/desktop`, Draft PR #1) -- Upbit public WebSocket market
  data, local Paper Trading, session persistence, basic risk limits, SMA/EMA strategy engine,
  control plane, desktop chart and event display.
- Single-user web Paper trading app (`apps/server` + `apps/web`, Draft PR #6) -- reuses
  `apps/desktop`'s business logic via relative import, polls Upbit's public REST candle
  endpoint instead of WebSocket, adds `packages/core`'s explicit domain pipeline
  (RiskEngine/OrderPlanner/PositionSizer/ExecutionReport/Portfolio/PnL), a champion/challenger
  strategy comparison system, on-demand backtesting, CSV export, webhook notifications, an
  installable PWA with mobile-specific hardening, and optional API-key auth + self-signed HTTPS.

### Not active

- Live Upbit orders
- Real exchange API key storage/usage
- Binance futures
- Autonomous real-money AI execution
- AI-driven trade proposals of any kind (see "AI rules")
- Decimal-based financial arithmetic (see "Financial rules")
- Native mobile app, Device Trust, biometric authentication
- Native push notifications (webhook-based notifications exist; Web Push does not)

## Product stages

### Stage 1 -- Upbit Spot Research and Paper

- deterministic accounting
- durable persistence
- backtest engine
- decision engine
- risk engine
- strategy registry (SMA/EMA today; more later)
- performance analytics
- failure recovery

### Stage 2 -- Upbit Spot Live Candidate

Only after measurable paper evidence and explicit owner approval:

- API credential vault
- read-only account sync
- dry-run order adapter
- kill switch
- daily loss limit
- reconciliation
- idempotent order handling

### Stage 3 -- Binance Futures

Only after the spot system is mature:

- isolated futures domain model
- leverage and margin controls
- liquidation and funding awareness
- futures-specific strategies and risk policies

## Current goal: release DOKKAEBI v1.0

Required milestones, status tracked honestly (not all claimed done):

| Milestone | Status |
|---|---|
| Stable Paper Trading | Largely in place across both apps; no long-duration burn-in run yet |
| Mobile Control | Responsive PWA with mobile-specific hardening exists; not a native app |
| Ledger | Audit-only reference ledger exists; not Decimal, not correction-event-sourced |
| Recovery | Fail-closed restore exists; not the explicit 6-stage sequence described above |
| Audit | Event log (id/type/message/timestamp) exists, translated, CSV-exportable |
| Kill Switch | Exists and takes priority over trading |
| AI Summary | Not built -- no AI-generated summary exists anywhere yet |
| Approval | Not built -- no proposal/approval workflow exists (see "AI rules") |
| Push Notification | Webhook notifications exist; native push does not |

## Success metrics

Trading metrics: CAGR, maximum drawdown, Sharpe and Sortino ratios, profit factor, expectancy,
recovery factor, exposure.

System metrics: crash-free runtime, deterministic recovery, WebSocket reconnect reliability,
duplicate-order prevention, persistence integrity, test and CI health.

Performance targets: Dashboard < 1s, API < 200ms, Kill Switch < 500ms, Recovery < 60s (not yet
formally measured against these exact numbers -- see "Performance targets" above).

## Working roles

- Owner: final investment and live-trading approval.
- AI implementation agents (Codex, Claude, and others as used): implementation, tests,
  refactoring, commits, and pull requests -- always under this charter, never overriding it.
- ChatGPT: architecture, research, audit, risk review, and prioritization.
- GitHub: source of truth for code, decisions, and current state.

## Current source of truth

Two active branches/PRs, not one:

```text
agent/electron-upbit-paper-trading   (Draft PR #1 -- apps/desktop Electron app)
claude/progress-p13dc7               (Draft PR #6 -- apps/server + apps/web + packages/core)
```

PR #6 was built by porting PR #1's `apps/desktop` content over commit-by-commit as its own
independent history (see PR #6's own description), so it currently includes a full duplicate
copy of PR #1's still-unmerged Electron app. PR #6 should probably not merge before PR #1 does --
left as an explicit owner judgment call.

Before starting work, read this file, `AGENTS.md`, the active PR(s), current tests, and the
latest branch state.

## Known gaps against this charter (tracked, not hidden)

Ranked by how much they'd change if addressed, largest first:

1. **Decimal migration** -- every financial number is a JS `float` today. Largest, riskiest,
   most breaking gap. Needs an owner-approved plan before touching code (which representation,
   how persisted/serialized data migrates), not a unilateral rewrite.
2. **AI proposal -> approval workflow** -- does not exist. No AI makes trading decisions today.
3. **Native mobile app / Device Trust / biometric auth** -- does not exist; today's mobile
   support is a hardened responsive PWA, not a native app.
4. **Native push notifications** -- webhook notifications exist; Web Push (VAPID subscriptions,
   OS-level notifications when the app isn't open) does not.
5. **Explicit staged Recovery sequence** (Database -> Exchange -> Ledger -> Position -> Market
   Data -> Safe State) with its own tests -- today's recovery is "load from SQLite or fail
   closed," not a verified multi-stage sequence.
6. **`Result<T,E>` across `apps/server`/`apps/desktop`** -- those layers throw/catch today;
   `packages/core` already uses discriminated-union results.
7. **Formal performance measurement against the four named targets** (Dashboard/API/Kill
   Switch/Recovery) -- benchmarks exist for current hot paths, not mapped to these targets.
8. **Burn-in and dedicated Recovery test suites** -- Unit/Integration exist extensively; E2E is
   manual (Playwright, not checked in); Burn-in and Recovery suites do not exist.

Resolved: structured `requestId`/`commandId`/`userId`/`deviceId` logging (see "Logging" above) --
built, tested, and browser-verified.
