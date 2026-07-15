# Persisted research validation

Research completion is derived from persisted, immutable run manifests and independent validation reports.

Required run types:

- WALK_FORWARD
- COST_STRESS
- MONTE_CARLO
- INTEGRITY_CHECK

A manifest binds strategy identity, parameter checksum, dataset identity and checksum, time range, sample count, code version, configuration checksum, result checksum, and its own canonical SHA-256 checksum.

A PASS is valid only when the persisted report is independently replayable and all required checks pass. Monte Carlo is deterministic, seeded, and records its seed hash; it is a risk-distribution check, not a profitability claim. UI booleans, environment variables, test execution, CI status, and memory-only counters cannot create research evidence. Failed or incomplete reports never create PASS evidence.

Operational Paper observations remain separate from research validation results. Research validation does not increase Paper scenario counters and does not change runtime trading state.

## Monte Carlo recording

`persistMonteCarloResearch` accepts an explicit return sample from an approved research workflow, runs the deterministic simulation, validates the result, and writes its immutable manifest and report in one SQLite transaction. It never downloads data, calls an exchange, stores raw returns, or stores the seed string. The persisted manifest contains only the return-sample checksum and seed hash. Repeating an identical `runId` is idempotent; a changed payload for that ID is rejected without a partial write.

The storage boundary independently validates every manifest and report. A report cannot be appended before its manifest, cannot use a different run type or result checksum, and cannot contain unsupported status, malformed timestamps, blank reasons, or an invalid SHA-256 result identity.
