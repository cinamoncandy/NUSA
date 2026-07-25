# Web Single-User Paper Trading App (v0.1)

## Context

The Electron desktop app (`apps/desktop`, PR #1) is a single-user Paper trading
application, and `DOKKAEBI.md` states that single-user model as a foundational
design premise, not a placeholder. The owner asked for a browser-accessible
version of the same idea -- an API server plus a web UI -- with an explicit,
deliberate scope decision: **build and prove out the single-user version
first; multi-user accounts (signup/login, per-user data isolation) are a
later phase, not part of this change.**

Because of that decision, this change adds no user/account/session/password
system, no new external dependency, and no multi-tenant persistence schema.
It reuses this repo's existing Paper-trading business logic (already
Electron-free) behind a plain `node:http` server and a small static web
frontend, and stops there.

## Why a new, separate surface

- `main` (this repo's default branch) does not yet contain `apps/desktop`'s
  business logic at all -- it's still unmerged on PR #1's branch
  (`agent/electron-upbit-paper-trading`). A branch cut from `main` could not
  have reused `PaperBroker`/`StrategyEngine`/etc. without duplicating them.
- This work therefore lives on `claude/progress-p13dc7` (this session's
  designated branch), which already carries that code, and is **not** ported
  to PR #1's branch and **not** part of PR #1's scope or audit. PR #1 remains
  exactly what it was: the Electron desktop app.
- `pnpm install` cannot complete in this sandbox (a git-sourced transitive
  dependency of `electron` is blocked), so every new module here uses only
  Node.js built-ins (`node:http`, `node:sqlite`, `node:crypto`-free password
  handling isn't needed since there are no accounts yet, global `fetch`) --
  this was verified by actually starting the server and driving it with a
  real browser in this same sandbox (see Verification below).

## What was added

- `apps/server/src/paperRuntime.ts` -- wires the same reusable pieces
  `apps/desktop/src/main.ts` wires for Electron (`PaperBroker`,
  `StrategyEngine`, `ControlPlane`, `RuntimeCommandService`,
  `buildPaperDashboardSections`, `DesktopPersistenceStore`) into a
  `PaperRuntime` class, imported directly from `apps/desktop/src/*` via
  relative path -- **no file under `apps/desktop` was modified**. Uses its
  own SQLite database file (`DOKKAEBI_SERVER_DB`, default
  `<cwd>/data/dokkaebi-server.db`), completely independent of the Electron
  app's own database; the two are unrelated accounts/processes.
- Live price feed: `apps/server/src/liveCandleFeed.ts` polls Upbit's public
  `/v1/candles/minutes/{unit}` REST endpoint (no API key, real data) instead
  of the WebSocket ticker `apps/desktop` uses, so this server needs no `ws`
  package. Trade-off stated plainly: signals are generated once per poll
  (default every 10s), not per real trade tick. The same polled candles also
  drive the web UI's chart -- this repo previously had no live/minute candle
  fetching anywhere (only an offline daily-candle mapper for backtesting).
- `apps/server/src/emaCrossoverStrategy.ts` -- an EMA crossover strategy
  implementing the existing `TradingStrategy` interface
  (`apps/desktop/src/strategyEngine.ts`), selectable alongside
  `SmaCrossoverStrategy`. Addresses the "no EMA" gap without touching
  `apps/desktop`.
- `apps/server/src/apiRouter.ts` + `httpServer.ts` -- a pure, testable
  request handler (same convention as
  `apps/cloud/src/mobileDashboardHttp.ts`) wrapped by a minimal
  `node:http` server: `GET /api/{health,market,chart/candles,account,control,
  dashboard}`, `POST /api/orders`, `POST /api/strategy/{start,stop,
  auto-trade,quantity,select}`, plus static file serving for `apps/web/`
  with path-traversal rejection.
- `apps/web/` -- a small, self-contained, dependency-free (no framework, no
  bundler) HTML/CSS/JS frontend: live candlestick chart (canvas), account
  panel, strategy controls (start/stop/auto-trade/quantity/SMA-or-EMA
  select), manual buy/sell, a fills table with the same execution-cost
  breakdown column added to the desktop renderer earlier on this branch, and
  an AI CIO dashboard grid that reports `committee`/`research` as
  `BLOCKED`/`SOURCE_NOT_CONNECTED` honestly, matching the desktop app's own
  "don't invent what isn't real" convention.
- Root `package.json`: `server` / `server:dev` scripts
  (`pnpm run build && node dist/apps/server/src/main.js`).

## Explicitly out of scope (by the owner's own phasing decision)

- User accounts, signup, login, sessions, multi-tenant data isolation.
- Real/live order routing, exchange credentials -- still Paper-only,
  identical safety posture to the Electron app (`docs/NEXT_TASK.md` rule 6).
- Tick-level live data -- prices update once per REST poll (~10s), not per
  trade like the WebSocket-driven desktop app.

## Follow-up: strategy-choice persistence

The selected strategy (SMA/EMA) now also survives a server restart. This is
kept in a small sidecar JSON file (originally
`apps/server/src/strategyChoiceStore.ts`, later renamed to
`runtimeSettingsStore.ts` -- see "expanded feature set" below --
`${databasePath}.strategy-choice.json`) rather than added to
`DesktopPersistenceStore` -- that store is reused as-is from `apps/desktop`
and is not otherwise modified by this product. Losing this file only falls
back to the SMA(5, 20) default, never a fault of account/order/control
state. Covered by `tests/runtime-settings-store.test.js` and
`tests/server-strategy-persistence.test.js` (restart round-trip via a real
`PaperRuntime` instance against a temp SQLite file).

## Follow-up: expanded feature set (v0.2, this same branch)

Everything below landed as incremental, independently-verified commits on
`claude/progress-p13dc7` after the v0.1 baseline above -- each with its own
compile + full test-suite pass + real-server/real-browser check, same rigor
as v0.1's own Verification section. Summarized here rather than rewritten
into the sections above, since those describe the original scope decision
and its reasoning, not a changelog.

- **`packages/core` domain layer** (RiskEngine/OrderPlanner/PositionSizer/
  ExecutionReport/Portfolio/PnL) wired into the automatic-trading pipeline
  as a value-based audit/risk layer alongside `PaperBroker`.
- **Audit trail**: reference accounting + real-vs-reference reconciliation,
  equity curve + drawdown, trade statistics (win rate, profit factor,
  expectancy), event log -- all read-only, all reusing tested pure
  functions rather than reimplementing arithmetic.
- **Risk/order features**: stop-loss/take-profit/trailing-stop position
  protection, configurable position sizing (FIXED/FIXED_FRACTIONAL),
  configurable strategy periods, limit orders, one-click position close
  (전량 청산) -- all persisted across restarts (`runtimeSettingsStore.ts`),
  all correctly handling `PaperBroker`'s `maxFillRatio` fill cap (retry
  until flat, or give up and disable on a genuinely unsellable remainder).
- **Champion/challenger system** (`championSystem.ts`): 3 fixed alternate
  strategy presets run as isolated shadow `PaperBroker`s against live
  ticks, compared against the real active strategy, with a manual-only
  promote action (never automatic -- `docs/NEXT_TASK.md` rule 6's
  "no automatic promotion" policy applies here too even though that rule
  was written for the Electron app's own governance surface).
- **On-demand backtest** (`runBacktestComparison`): reuses
  `apps/desktop/src/backtestEngine.ts`'s existing `runBacktest()` as-is
  against up to 200 real recent Upbit candles, selectable as 1-minute
  (~3.3 hours) or day (~200 days) via `fetchRecentDayCandles`.
  Independent of the live shadow system -- instant, not accumulated over
  real elapsed time.
- **CSV export**, mobile-responsive layout (verified via Playwright at a
  390px viewport), a tabbed (거래/성과/감사) redesign, and a bounded-row cap
  on the fills table (event log already had one) to keep a long-running
  session's DOM from growing unbounded.
- **Korean-only UI, exhaustively**: every error message (validation,
  domain rejection, 404/405, JSON-parse failure, Upbit poll failure),
  every event-log entry, every status/side/strategy-name label is
  translated via `errorMessages.ts`/`logMessages.ts` -- not just the
  static UI copy. Unrecognized messages degrade to a Korean-prefixed
  fallback (errors) or pass through unchanged (routine log entries, so an
  unrecognized one isn't misrepresented as a failure) rather than ever
  showing raw English.
- **Reliability**: buttons that place real orders (매수/매도/전량 청산/
  지정가 등록/취소/포지션 보호) are disabled for the duration of their
  request, since manual orders have no server-side idempotency key the
  way automatic signals do.
- **Performance**: `scripts/performance-baseline.js` /
  `docs/performance-baseline.md` measure every hot path added along the
  way (order processing, market-data mapping, SQLite writes, recovery
  time, trade-stats/drawdown/reconciliation replay, champion-system
  candle-tick processing, backtest execution) -- P50/P95/P99, not just an
  average. No bottleneck found at any point; explicitly excludes
  GUI-dependent metrics this sandbox cannot honestly measure.

## Verification

- v0.1 baseline: `tests/ema-crossover-strategy.test.js`,
  `tests/live-candle-feed.test.js`, `tests/server-api-router.test.js`,
  `tests/server-http-integration.test.js` (44/44 passing together with the
  pre-existing `desktop`/`paper-broker`/`runtime-command-service` suites).
- Current (v0.2, whole repo): 1188/1188 passing (`tests/*.test.js`, minus 3
  pre-existing files excluded for unrelated sandbox-environment constraints
  -- `evidence-cli-contract`, `reliability-recovery`, `upbit-websocket` --
  confirmed unrelated to this work). Verified via this sandbox's manual
  `tsc` + `node --test` combination (`pnpm install`/`pnpm test` still
  cannot run here -- see "Why a new, separate surface" above).
- Manually started the real server (`DOKKAEBI_SERVER_PORT=... node
  dist/apps/server/src/main.js`) against real Upbit market data and: hit
  every endpoint with `curl`, confirmed state (cash/position/orders/control
  status) survives a full process restart against the same database file,
  and drove the actual web page in a real Chromium browser (Playwright) --
  loaded the dashboard, started the strategy, placed a manual buy, switched
  SMA to EMA, enabled auto-trade, and confirmed the fills table, account
  panel, and AI CIO grid all updated correctly with no console errors other
  than the browser's routine `favicon.ico` 404. Every v0.2 feature above
  received the same real-server/real-browser verification individually at
  the time it was added (see each feature's own commit message for its
  specific verification details).
