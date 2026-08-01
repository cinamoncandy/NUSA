# NUSA Coverage Baseline

## Purpose

This is the first machine-readable and human-readable coverage baseline for the
existing Vitest suite. It records the current measurement without enforcing an
arbitrary threshold.

## Command

```text
pnpm run test:coverage
```

The command runs the two existing `tests/**/*.vitest.js` contract suites and
writes the V8 reports to `coverage/`:

- `coverage/coverage-final.json` is the machine-readable report.
- `coverage/index.html` is the human-readable report.
- the terminal table is the CI-readable summary.

Coverage output is ignored by Git and uploaded by the CI workflow as the
`coverage-baseline` artifact. Generated reports are intentionally not committed.

## Initial measurement

Captured on 2026-08-01 from the repository-health recovery branch:

| Metric | Baseline |
| --- | ---: |
| Test files | 2 passed |
| Tests | 4 passed |
| Statements | 0% |
| Branches | 29.27% |
| Functions | 29.27% |
| Lines | 0% |

The current Vitest tests validate CSS, configuration, and renderer contract
strings by reading files. They do not import and execute the application
modules, so the zero statement/line result is an honest limitation of this
baseline rather than a quality target. The isolated Node test suite remains the
primary behavioral regression suite until executable Vitest coverage is added.

## Follow-up plan

1. Add executable tests for high-risk renderer, IPC, persistence, recovery, and
   risk-gateway paths.
2. Expand the coverage include scope only when those tests execute the source.
3. Re-record the baseline and propose a gradual threshold based on measured
   high-risk coverage.
4. Do not block merges on an invented percentage target.
