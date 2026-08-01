# NUSA Release Validation Report

Audited SHA: ad8b1da5e0d4e76bed1fea2e6e4e2dbdf84d71de
Branch: agent/mobile-first-ui-v1
Version: 0.1.0

## Gate results

| Gate | Result | Evidence |
|---|---|---|
| Repository health | PASS | preflight and isolated tests |
| Compilation | PASS | typecheck/build/release check |
| Runtime | UNVERIFIED | Electron GUI smoke not run |
| Trading | PASS | Paper regression suite; live mutation absent |
| Accounting | PARTIAL | authoritative Paper ledger still missing |
| Persistence | PASS | automated recovery suites |
| Recovery | PARTIAL | automated recovery PASS; GUI restart smoke unverified |
| Risk | PASS | risk gate and safety suites |
| Strategy | PASS | strategy regression and deterministic benchmark |
| Security | PASS | package validation, CSP/sandbox/preload tests |
| Performance | PARTIAL | 200k-tick microbenchmark only |
| Packaging | PARTIAL | package validation PASS; package:win blocked by HTTPS EACCES |
| Shadow | UNVERIFIED | no long-duration runtime execution |
| Documentation | PASS | release validation: 6 docs |

## Executed release commands

- `CI=true pnpm run release:validate`: PASS
- `CI=true pnpm run release:manifest`: PASS
- `CI=true pnpm run package:validate`: PASS
- `CI=true pnpm run release:check`: PASS
- `CI=true pnpm test`: PASS, 277 isolated test files

## Manifest safety

- mode: PAPER
- productionMutationAllowed: false
- liveTradingEnabled: false
- privateApiMutationCapabilityPresent: false
- credentialsConfigured: false
- signing: UNSIGNED_BUILD

## Blocking and deferred items

- P1: installer generation is blocked in this environment by electron-builder external HTTPS `EACCES`.
- P1: actual Electron launch/restart smoke is unverified.
- P2: long-duration Shadow evidence is unverified.
- P2: one-hour CPU/memory/listener/timer metrics are unverified.
- P2: authoritative Paper accounting ledger is not implemented.

## Recommendation

Do not classify as release-ready. Use a permitted Windows build host for package/install smoke, then run safe Electron restart validation and separate Shadow evidence collection.
