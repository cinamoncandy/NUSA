# AI Investment Committee v1

## Scope

This version is a deterministic PAPER/DRY_RUN decision boundary. It does not call an LLM, submit exchange orders, handle credentials, or enable LIVE trading.

## Members and opinions

Each specialist member publishes one immutable opinion containing a signal, confidence, edge, expected return, expected risk, time horizon, reasons, and observation time. Duplicate members, invalid ranges, and future observations fail closed.

## Consensus

The engine applies configured member weights multiplied by confidence and calculates weighted signal, confidence, edge, risk, agreement, disagreement, normalized entropy, and conflict level. Input order does not affect the result.

## Hard vetoes

The following conditions cannot be overridden by committee votes:

- active Kill Switch
- unresolved hedge recovery
- suspended strategy
- low execution quality
- non-positive net edge
- excessive portfolio heat
- drawdown limit breach
- insufficient margin buffer
- unsafe funding carry
- stale probability
- feature fingerprint mismatch

Kill Switch, unresolved recovery, or low margin buffer results in `EMERGENCY_EXIT`. Other vetoes result in `REJECT`.

## CIO outcome

Without a veto, the engine chooses among `WAIT`, `PAPER_ONLY`, `REDUCE`, `APPROVE_PARTIAL`, and `APPROVE` using deterministic thresholds. High conflict forces `WAIT`. Positive but insufficient consensus remains `PAPER_ONLY`.

## Safety boundary

This engine is advisory and read-only. Strategy Governance, capital guards, withdrawal reservations, recovery ledgers, and the Control Plane remain authoritative. Profitability is not guaranteed.

## Deferred work

- append-only committee ledger
- SQLite snapshot and replay verification
- calibrated adaptive member weights
- mobile explanation view
- authenticated LLM adapters
- any LIVE activation path
