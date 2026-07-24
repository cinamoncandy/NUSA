# Research Memory v1

## Scope

Research Memory v1 stores immutable research hypotheses and completed experiment records in the existing SQLite storage database. It links every experiment to a dataset ID, full dataset SHA-256, manifest version, market, interval, and candle range.

It is a provenance ledger, not a prediction system, strategy optimizer, or live-trading component.

## Immutable Inserts

Hypotheses and experiments are append-only. Repeating an insert with the same ID and identical fields returns the existing immutable record. Reusing an ID with different content fails with an ID conflict.

Experiment records store serialized Walk-Forward configuration and result JSON exactly as submitted after validating that both payloads are JSON. Records may optionally reference an existing hypothesis; missing references fail closed.

## SQLite Safety

Migration `002_research_memory` creates the Research Memory tables. Writes occur in database transactions. A failed write rolls back the record, and malformed persisted JSON or a corrupt database fails closed when read or opened.

No Research Memory data is exposed to the Electron renderer in this slice.

## Boundaries

Research Memory stores evidence and provenance. It does not prove data quality, strategy profitability, OOS robustness, or Paper readiness. Dataset checksum and source metadata remain reproducibility information, not independent validation.

No private API, credentials, live orders, AI, LLM, automated strategy generation, or Research Memory-driven trading action is part of v1.
