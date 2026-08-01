# NUSA Reliability Report

Audited branch: `agent/mobile-first-ui-v1`
Audited commit before this reliability slice: `3f981764dff53d7857bc196489f8b94fc1a9151b`

## Result

Repository verification completed 10 consecutive times with identical results.

- Typecheck: PASS on 10/10 runs
- Build: PASS on 10/10 runs
- Lint: PASS on 10/10 runs
- Full unit/integration/regression suite: PASS on 10/10 runs
- UI tests: PASS on 10/10 runs
- E2E tests: PASS on 10/10 runs
- Coverage: PASS on 10/10 runs
- Build tree hash: identical on 10/10 runs
- Coverage metrics: identical on 10/10 runs
- Coverage artifact manifest: identical on 10/10 runs

Coverage remained 84.37% statements/lines, 76.37% branches, and 92.56% functions.

Detailed evidence: `docs/audits/deterministic-execution-2026-08-02.md`.

## Reliability changes

- Added `pnpm run determinism` for fixed-environment sequential verification.
- Fixed Windows package-manager process launching in the harness.
- Included command exit state in deterministic signatures so repeated failures cannot be reported as PASS.
- Added UTC, fixed seed, sorted-test-order, build-hash, and artifact comparisons.

## Remaining risks

- Remote GitHub Actions execution was not run by this local audit.
- Native mobile, installed Electron, real Upbit, and long-duration runtime evidence remain external blockers.
