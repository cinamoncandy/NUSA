# WO-0036 Read-only Broker & Credential Integration

WO-0036 absorbs only the useful read-only concepts from stale A5b work onto the current protected main line.

## Boundary

- Provider-specific Upbit code stays outside Stable Core contracts.
- Broker network access is observation-only.
- Execution transport remains disconnected.
- Credentials are encrypted at rest through an OS-backed safe-storage port.
- Runtime decryption is scoped to main-process read-only broker authentication.
- Raw credentials are prohibited from renderer state, AI context, evidence, and logs.
- Order submit/amend/cancel, withdrawal, cash mutation, and position mutation are not exposed by `UpbitReadOnlyService`.
- Reconciliation reports `UNKNOWN`, `MATCH`, or `DIFF`; it never mutates portfolio state.
- CI uses mock transport only and performs no real broker calls.

## A5b reconciliation

The stale `agent/a5b-secure-credential-readonly-integration` branch is not merged. Its credential provider/service/reconciliation concepts were reimplemented against current `main`, current `UpbitReadAdapter`, AIPOS evidence semantics, and the WO-0035 capability-surface guard.

## Completion

Requires focused regressions, dedicated evidence artifact, existing LIVE safety gates, security gate, and full exact-head GitHub CI before merge.
