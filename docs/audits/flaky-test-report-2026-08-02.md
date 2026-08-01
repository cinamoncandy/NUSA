# NUSA Flaky Test Report

## Result

No flaky test was observed in 10 consecutive complete verification runs.

All 10 runs produced:

- zero command failures
- identical isolated test counts
- identical UI and E2E outcomes
- identical coverage metrics
- identical `dist` SHA-256
- identical coverage artifact manifest

Detailed run evidence: `docs/audits/deterministic-execution-2026-08-02.md`.

## Determinism controls

- Node test files execute in sorted order.
- `CI=true` is fixed for every child command.
- `TZ=UTC` is fixed for every child command.
- `NUSA_TEST_SEED=0` is fixed for every child command.
- Coverage and build artifacts are compared by machine-readable signatures.

No test assertion, timeout, retry, or production behavior was weakened.
