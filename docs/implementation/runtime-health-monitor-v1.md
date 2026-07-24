# Runtime Health Monitor v1

Runtime Health Monitor v1 converts append-only Runtime Orchestrator records and current transport metadata into a read-only operational health report.

## Inputs

- Runtime run records
- Snapshot generation time
- IPC health
- Queue depth
- Kill Switch state
- Explicit health thresholds

## Outputs

- `HEALTHY`, `WARNING`, `CRITICAL`, or `BLOCKED`
- Health score from 0 to 100
- Consecutive failure count
- Last successful run time
- Snapshot age
- Per-stage counts, latency, latest status, and latest reason
- Deterministic warning reasons

## Fail-closed behavior

The monitor rejects duplicate run IDs, future timestamps, malformed time values, and zero or invalid thresholds. Missing runtime records or a missing snapshot cannot produce a healthy report. An active Kill Switch always produces `BLOCKED` regardless of lower-severity conditions.

## Safety boundary

This module is read-only. It cannot place orders, change strategies, disable the Kill Switch, promote research, reserve or withdraw capital, or enable Live Trading.
