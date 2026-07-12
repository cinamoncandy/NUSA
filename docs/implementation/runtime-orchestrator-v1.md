# Runtime Orchestrator v1

Runtime Orchestrator v1 provides a deterministic PAPER/DRY_RUN execution boundary for ordered runtime stages.

## Contract

A run receives a single immutable-style `RuntimeContext` and executes registered stages in order. Each stage must return `SUCCESS`, `BLOCKED`, or `FAILED` with valid timing metadata.

```text
Research
→ Opportunity
→ Committee
→ Risk
→ Portfolio
→ Dashboard
→ Publish
```

The orchestrator does not implement these engines. It only controls ordering, validation, failure propagation, and recording.

## Fail-closed behavior

- Active Kill Switch blocks the run before the first stage.
- `BLOCKED` stops all following stages without treating a policy denial as a crash.
- `FAILED` stops all following stages and recommends Kill Switch review.
- Thrown exceptions and malformed stage results are converted to audited `FAILED` results.
- Skipped stage names are retained explicitly.
- Duplicate stage names and duplicate run IDs are rejected.
- Runtime records and nested results are cloned and frozen.

## Recorder

`InMemoryRuntimeRecorder` is append-only by run ID. It exists as a deterministic contract and test implementation. Durable SQLite recording is a separate future integration and must preserve append-only semantics.

## Safety boundary

This module has no exchange adapter, credential, private API, order placement, cancellation, strategy promotion, withdrawal, or LIVE activation path. It must not be interpreted as proof of profitability or production readiness.
