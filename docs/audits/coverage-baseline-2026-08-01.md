# NUSA Coverage Baseline Audit

Audit date: 2026-08-01
Audited recovery head: `e2bd51395257a430fbf7055c2de22bed6e8ceb10`

Command: `pnpm run test:coverage`

The V8 provider emits text, JSON, LCOV, and HTML reports under ignored
`coverage/`. CI uploads the same directory as the `coverage-baseline` artifact.

| Metric | Baseline |
| --- | ---: |
| Test files | 2 passed |
| Tests | 4 passed |
| Statements | 0% |
| Branches | 29.27% |
| Functions | 29.27% |
| Lines | 0% |

The baseline is measurement-only. Current Vitest tests read and validate CSS,
configuration, and renderer contracts rather than executing application modules,
which explains zero statement/line coverage. High-risk runtime areas needing
executable coverage are execution transitions, accounting, persistence/recovery,
reconciliation, risk/kill switch, reconnect, IPC trust boundaries, and
credential redaction.

No arbitrary 80% gate is introduced. The next stage is to prevent measured
regression, then add critical-package thresholds from real executable coverage.
