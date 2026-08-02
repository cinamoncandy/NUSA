# NUSA Complete Gap Backlog

Audited: 2026-08-02
Audited commit: `05477d1f9787b78788757278305359a8583cdf77`
Working tree: contains the uncommitted mobile release validator and security-fixture correction.

This report uses repository implementation, tests, and prior audit evidence. Missing external runtime evidence is not treated as implementation completion.

## Capability status

| Capability | Status | Priority | Repository evidence | Remaining gap |
|---|---|---:|---|---|
| Core runtime | VERIFIED_COMPLETE | P0 | `tests/core-runtime.test.js`, `tests/runtime-orchestrator.test.js`, full suite PASS | None in repository evidence |
| Paper execution | VERIFIED_COMPLETE | P0 | Paper broker, command boundary, admission tests; full suite PASS | Live mutation remains out of scope |
| Accounting, Ledger, Portfolio projection | VERIFIED_COMPLETE | P0 | `docs/audits/accounting-release-slice-2026-08-02.md`; Ledger/Recovery tests 69/69 | Paper-scoped by design |
| Persistence and Recovery | VERIFIED_COMPLETE | P0 | Recovery reconciliation, SQLite recovery, crash marker tests | External power-loss drill not run |
| Offline Engine | VERIFIED_COMPLETE | P1 | Durable cache, sync, conflict, action queue tests; full suite PASS | Device-level offline runtime not run |
| Risk Engine | PARTIAL | P1 | `docs/audits/risk-engine-audit-2026-08-01.md`; gateway tests PASS | Desktop Paper and execution-domain policy DTOs remain separate; durable main-runtime sink coverage is incomplete |
| Risk Evidence | VERIFIED_COMPLETE | P0 | `tests/risk-evidence.test.js`; query and recovery evidence PASS | None in repository evidence |
| SMA strategy routing | IMPLEMENTED_UNVERIFIED | P1 | Strategy governance and restart tests PASS | Long-running runtime evidence absent |
| Upbit public market data | IMPLEMENTED_UNVERIFIED | P1 | Upbit websocket/reconnect tests; adapter boundary audit | Real read-only Upbit runtime and reconnect observation absent |
| Exchange abstraction | PARTIAL | P1 | `docs/audits/exchange-coupling-audit-2026-08-01.md` | Canonical exchange/profile contract is not complete; external runtime absent |
| Secure Storage | PARTIAL | P1 | Secure-storage tests PASS | Native OS secure-storage binding/runtime evidence absent |
| Biometric/PIN authentication | PARTIAL | P1 | Mobile biometric tests PASS | Native Face ID/Touch ID/fingerprint adapter evidence absent |
| Trusted Device | PARTIAL | P1 | Trusted-device lifecycle tests PASS | Native device identity and platform verification absent |
| Session security | PARTIAL | P1 | Session and secure-session tests PASS | Platform runtime re-authentication/recovery absent |
| Mobile architecture/runtime | BLOCKED | P1 | `apps/mobile/src`, mobile shell/security tests | No Android/iOS native build or device runtime evidence |
| Mobile release validation | BLOCKED | P1 | `docs/audits/release-candidate-audit-2026-08-02.md`; native mobile release pipeline is absent | Android/iOS signed artifacts and required runtime evidence absent |
| Runtime metrics and health | VERIFIED_COMPLETE | P1 | Runtime metrics/health tests; bounded instrumentation | Long-duration soak remains unverified |
| Long-duration stability | IMPLEMENTED_UNVERIFIED | P1 | Shadow observation tests and runtime metrics | External CPU, memory, battery, queue, listener, crash run absent |
| Desktop functional UI | PARTIAL | P2 | Renderer/bootstrap/E2E tests | Installed Electron smoke not executed |
| Windows packaging | IMPLEMENTED_UNVERIFIED | P2 | `package:validate` and `release:validate` PASS | Clean install/upgrade/uninstall evidence absent; signing unavailable |
| Test infrastructure | VERIFIED_COMPLETE | P1 | Full isolated suite 294 files PASS; UI 4/4 PASS; E2E 4/4 PASS; coverage PASS with elevated workspace access | Browser coverage remains separately uninstrumented |
| Security supply chain | VERIFIED_COMPLETE | P0 | Security gate PASS; zero high/critical vulnerabilities; secret scan PASS; lockfile integrity PASS | Existing Windows artifact remains unsigned, but is not mobile evidence |
| Live trading | OUT_OF_SCOPE | N/A | Deployment boundary tests; mutation remains false | Explicitly excluded from v0.1 |

## Resolved P0

- Security gate false positive from the intentional token fixture: resolved by constructing the test token at runtime; security gate now reports zero findings.
- UI/coverage startup failure: repository tests pass with approved workspace access; the failure was restricted-sandbox access to esbuild's parent directory, not application behavior.

## Remaining P0

None verified in repository code or automated tests.

## Remaining P1

1. Native Android/iOS build, signing, and device runtime evidence. Release-target changes remain deferred until this audit backlog is resolved.
2. Mobile background/foreground, network switching, airplane mode, offline replay, push, battery, memory, and crash evidence.
3. Real read-only Upbit runtime and bounded reconnect observation.
4. Long-duration runtime/Shadow stability evidence.
5. Canonical composition and durable-sink coverage for all Risk policy surfaces.
6. Installed Electron restart/recovery smoke remains unverified, even though desktop is not a mobile production gate.

## Remaining P2

1. Clean Windows install/upgrade/uninstall validation and signed installer evidence.
2. Browser execution coverage instrumentation.
3. Deferred UI visual redesign.

## Exact next blocker

The next blocker is the repository-backed P1 audit backlog: complete the native mobile runtime/build work and its evidence before changing release targets. No source-only change can truthfully replace device evidence.
