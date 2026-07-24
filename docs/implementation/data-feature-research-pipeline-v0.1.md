# Data, Feature, and Research Promotion Pipeline v0.1

This slice adopts the strongest structural ideas observed in the Forven and Kairos reference projects without copying their implementation.

## Flow

```text
Raw provider observations
  -> metadata and timestamp validation
  -> semantic provenance fingerprint
  -> freshness classification
  -> validated feature store boundary
  -> CIO signal adapter
  -> research promotion gate
  -> Paper only
```

## Safety rules

- Raw observations never flow directly into the CIO.
- Each feature carries provider, unit, cadence, symbol, and source semantics.
- A cadence, unit, provider, or feature identity change moves the provenance fingerprint.
- Stale features are retained for diagnostics but excluded from CIO signals.
- Non-finite observations are rejected.
- Duplicate observation IDs and duplicate feature keys fail closed.
- Research evidence generated under a different data fingerprint is rejected as stale.
- Promotion requires DSR, OOS/IS, OOS trade count, profit factor, positive walk-forward share, Monte Carlo ruin probability, and worst cost-stress return gates.
- Promotion means `PROMOTE_TO_PAPER`; it never enables live trading.

## Current limits

This is an in-memory deterministic contract. It does not yet include a physical feature database, provider ingestion jobs, model training, exchange credentials, or live order execution.
