# NUSA Coverage Baseline

Audited commit: `ee3f0dd4270e0de3c0f0a62af1fc56265bfe0420`
Generated: 2026-08-02 (Asia/Seoul)
Environment: Windows, Node `v24.18.0`, pnpm `11.7.0`, x64

## Result

Coverage generation: PASS.

The baseline is report-only. No repository coverage threshold is configured, so this report does not invent a failing threshold. The unified report combines Node V8 coverage from the isolated suite with the Vitest V8 report for renderer modules that actually executed. Playwright E2E is executed by the coverage command; Chromium page JavaScript is not instrumented by the current static-server configuration.

| Metric | Covered | Total | Result |
|---|---:|---:|---:|
| Statements | 32,115 | 38,065 | 84.37% |
| Branches | 8,685 | 11,372 | 76.37% |
| Functions | 1,967 | 2,125 | 92.56% |
| Lines | 32,115 | 38,065 | 84.37% |

## Executed suites

| Suite | Evidence | Result |
|---|---|---|
| Core isolated tests | `pnpm test` behavior reproduced by `scripts/run-coverage.js`; 291 isolated files | PASS |
| UI tests | Vitest, 2 files, 4 tests, V8 provider | PASS |
| E2E tests | Playwright, 4 tests | PASS |
| Unified report | JSON, JSON summary, LCOV, HTML | PASS |

## Lowest modules

No threshold is configured. The lowest observed modules are:

- `apps/cloud/src/conflictAnalyzer.ts` — 0% statements, branches, functions, lines
- `apps/cloud/src/consensusEngine.ts` — 0% across all metrics
- `apps/cloud/src/fundingCarryEngine.ts` — 0% across all metrics
- `apps/cloud/src/memberScoring.ts` — 0% across all metrics
- `apps/desktop/renderer/application-state-mount.js` — 0% across all metrics
- `apps/desktop/renderer/brand-ui.js` — 0% across all metrics
- `apps/desktop/renderer/component-library.js` — 0% across all metrics
- `apps/desktop/renderer/control-room.js` — 0% across all metrics
- `apps/desktop/renderer/mobile-view-model.js` — 0% across all metrics
- `apps/desktop/renderer/product-screens.js` — 0% across all metrics

## Untested critical paths

The report identified these repository modules at 0% and they require a future focused test mission if their runtime paths remain release-critical:

- `packages/aipos/src/recovery.ts`
- `packages/storage/src/balance-reconciliation.ts`
- `packages/storage/src/fee-reconciliation.ts`
- `packages/storage/src/fill-reconciliation.ts`
- `packages/storage/src/funding-reconciliation.ts`
- `packages/storage/src/liquidation-risk.ts`
- `packages/storage/src/pnl-reconciliation.ts`
- `packages/storage/src/recovery-evidence.ts`

No tests were added in this baseline mission because these modules are not on the verified current Paper/Risk/Offline/Security execution path; adding speculative tests would expand scope without a runtime contract. Existing focused suites cover `apps/execution/src/global-risk-gateway.ts`, `apps/execution/src/offline-engine.ts`, mobile security, secure storage, Ledger projection, and recovery behavior.

## CI and artifacts

CI now runs `pnpm run coverage` and uploads the `coverage/` directory as artifact `coverage-baseline` with 14-day retention. Local artifacts are generated at:

- `coverage/unified-summary.json`
- `coverage/unified-report.md`
- `coverage/unified-lcov.info`
- `coverage/index.html`
- `coverage/core/index.html`
- `coverage/ui/index.html`
- `coverage/baseline-manifest.json`

## Remaining blockers

- E2E browser-page coverage is UNVERIFIED/UNINSTRUMENTED, because the current Playwright setup serves static pages and has no Chromium instrumentation hook. E2E execution itself is PASS.
- Native/mobile runtime coverage is outside this baseline and remains governed by the existing production-readiness blocker records.
