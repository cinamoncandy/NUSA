# Next Task

## Current Governance Baseline

Strategy Governance v1 and AI Investment Committee v1 are deterministic PAPER/DRY_RUN control layers. They do not create strategies, call an LLM, submit orders, enable LIVE trading, handle credentials, or override Risk, Probability/Edge, Kelly, Control Plane, Kill Switch, or Strategy Governance gates.

Current hardening priorities:

1. Persist governance and committee command-id idempotency atomically with their ledgers.
2. Move governance and committee table creation into a numbered, checksum-reviewed SQLite migration plan.
3. Reconcile persisted registry state with ledger replay during service startup and fail closed on any difference.
4. Add operator-facing read-only recovery status; do not add a live execution path.
5. Keep PR #1 Draft and do not merge without owner review.

## Completion update

The stabilization work below is implemented on `agent/electron-upbit-paper-trading`:

- malformed Paper and Control Plane sessions return visible diagnostics and fail closed;
- Paper account state, Control Plane status, events, order quantity, and processed automatic signal keys persist atomically;
- automated trading is always disabled after restart;
- faulted recovery state cannot restart a strategy without operator repair;
- duplicate automatic signals cannot create duplicate Paper orders;
- risk rejection is recorded as an outcome without terminating the process;
- manual and automatic Paper orders continue to use the same broker risk limits.

Validation after implementation:

- `pnpm run typecheck`: PASS
- `pnpm test`: PASS (39 tests)

## Current next task

Replace JSON session persistence with a versioned SQLite event and account repository while preserving the recovery and default-off guarantees established here. Build the backtest engine against the same strategy, risk, and accounting contracts.

## Stabilization objective (completed)

## Objective

Stabilize the current Upbit spot Paper Trading branch before adding broader features.

## Required work

1. Run the full TypeScript build and Node test suite on a clean checkout.
2. Fix any compile, path, packaging, or test failures.
3. Make the Paper session persistence recover safely from malformed or partially written state.
4. Persist Control Plane state and events without enabling auto-trading after restart.
5. Add deterministic tests for:
   - malformed session recovery,
   - strategy start/stop state,
   - automatic-trading default-off behavior,
   - duplicate signal/order prevention,
   - risk rejection without process failure.
6. Replace the renderer's ad-hoc chart only if doing so does not delay stability work.
7. Update the active PR with actual validation results.

## Acceptance criteria

- `pnpm run typecheck` passes.
- `pnpm test` passes.
- App restart restores Paper account state but leaves automated trading disabled.
- Corrupt state fails closed and produces a visible diagnostic instead of silently resetting or trading.
- One market event cannot produce duplicate automatic orders.
- Existing risk limits remain enforced for manual and automatic Paper orders.
- No live order path, API credential handling, or Binance futures code is added.

## After this task

Proceed to a versioned SQLite event and account repository, then build the backtest engine against the same strategy and accounting contracts.
