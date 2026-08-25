# NUSA Investment Performance Engine Data Requirements

Benchmark evidence must preserve point-in-time correctness, stable ordering, deterministic dataset identity, missing-candle policy, source request provenance, and content checksum. Multi-market and multi-timeframe runners may aggregate scorecards, but must never mix candle metadata inside one dataset manifest.

Data gaps, insufficient sample size, narrow market coverage, and narrow timeframe coverage must remain explicit warnings rather than being silently imputed into stronger evidence.
