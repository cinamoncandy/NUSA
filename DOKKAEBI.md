# DOKKAEBI

Dokkaebi is a TypeScript monorepo for deterministic, auditable cryptocurrency execution research. The reconstructed baseline focuses on exact position accounting, durable SQLite projection state, and a pure pre-trade risk decision engine.

## Current Scope

The current repository contains:

- `packages/contracts`: shared accounting and risk contracts.
- `packages/storage`: SQLite ledger, snapshot repositories, applied markers, transaction handling, and repair services.
- `apps/execution`: a pure pre-trade risk engine with no database or repository dependency.
- `tests`: behavioral accounting, persistence, recovery, and risk tests.

The baseline is not a production trading system. It does not include exchange connectivity, credential handling, live order submission, a strategy runtime, a desktop application, or a control plane.

## Non-Negotiable Invariants

1. Monetary and quantity accounting uses raw `bigint` values. JavaScript `number` must not be used for monetary arithmetic.
2. Ledger replay order is `ts ASC, createdAt ASC, id ASC`.
3. Ledger append is idempotent by entry ID.
4. Snapshot projection and applied-marker writes occur in one SQLite transaction.
5. Transaction failures preserve the identity of the original error.
6. Audit reads are read-only.
7. Rebuild is an explicit mutation and must be deterministic when the ledger is unchanged.
8. The pre-trade risk engine is pure and may not access repositories, SQLite, network clients, or exchange APIs.
9. Live trading must never be inferred from the current baseline. Any future live mode requires an explicit design and review boundary.

## Accounting Rules

- Buy increases base quantity and adds known quote cost.
- Additional buy derives average entry from aggregate raw quote cost divided by aggregate raw base quantity.
- Partial sell releases proportional cost basis and realizes PnL only when quote proceeds are known.
- Full sell clears remaining cost basis and average entry.
- Quote-less buy or sell never invents quote amounts.
- Oversell is rejected.
- Closed positions may reopen while retaining realized PnL history.

Integer division follows `bigint` truncation. Callers are responsible for using compatible raw-unit scales.

## Development Commands

```powershell
pnpm install
pnpm run typecheck
pnpm run build
pnpm test
```

`typecheck` runs the real TypeScript compiler with `--noEmit`. Tests use Node's built-in test runner and exercise the compiled output.

## Change Policy

Keep changes narrow, preserve exact arithmetic, and add behavior-focused tests for every accounting or recovery rule. Documentation must distinguish shipped behavior from roadmap proposals.
