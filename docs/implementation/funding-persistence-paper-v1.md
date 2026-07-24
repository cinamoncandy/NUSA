# Funding Persistence Paper v1

## Purpose

PAPER/DRY_RUN-only append-only execution evidence for the Funding Persistence candidate. This module does not connect to an exchange, submit LIVE orders, access credentials, allocate capital, or promote a strategy automatically.

## Ledger contract

Every paper event has a monotonically increasing sequence number, the previous event hash, and a canonical SHA-256 content hash. The ledger has its own snapshot hash and head hash. Verification rejects duplicate IDs, broken sequence numbers, broken hash links, event mutation, and snapshot mutation.

Supported lifecycle:

```text
NEW -> QUEUED -> ACCEPTED -> PARTIAL_FILL -> FILLED -> CLOSED -> ARCHIVED
```

Cancellation and rejection are terminal before archive. Invalid transitions fail closed.

## Replay

Replay rebuilds deterministic order snapshots from the event ledger. It calculates cumulative filled quantity and volume-weighted average fill price, rejects overfills, and requires an exact requested quantity on `ORDER_FILLED`.

## Daily report

The daily report contains created, filled, rejected, cancelled, and closed counts plus gross realized PnL, fees, slippage cost, net realized PnL, and traded quantity. Reports are immutable and SHA-256 identified.

## Champion candidate gate

The candidate report checks:

- minimum distinct Paper days;
- minimum closed positions;
- minimum net realized PnL;
- maximum rejection ratio;
- Walk-Forward aggregate pass when required;
- Stress pass when required.

A passing report is only an eligibility artifact. It cannot change registry state, promote a strategy, release a kill switch, or enable LIVE trading. Human governance remains mandatory.

## Safety boundaries

- PAPER/DRY_RUN only;
- no private exchange API;
- no credentials;
- no withdrawal path;
- no automatic capital allocation;
- no automatic Champion promotion;
- all malformed or unverifiable ledgers fail closed.
