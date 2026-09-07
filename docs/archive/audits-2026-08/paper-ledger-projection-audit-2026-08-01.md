# Paper Ledger Projection Audit

- Audited commit: `dadf068`
- Scope: replay the append-only Paper ledger and compare it with the broker projection

## Verification

- `CI=true pnpm.cmd run build`: PASS
- `node --test tests/paper-ledger-projection.test.js tests/paper-broker-fill-model.test.js`: PASS, 15/15

## Result

- Ledger replay reproduces cash, quantity, average price, realized PnL, unrealized PnL, and equity for buy/sell flows.
- Sequence gaps, duplicate fills, before-state tampering, after-state tampering, invalid fills, and oversells fail closed.

## Limitation

The broker still performs the live Paper mutation and the replay is a verification projection. Transferring financial ownership to a ledger-driven accounting service remains a separate task.
