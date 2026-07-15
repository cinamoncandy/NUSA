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
