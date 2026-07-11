# Next Task

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
