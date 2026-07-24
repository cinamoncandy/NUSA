# Architecture Audit v1

## Purpose

`architectureAudit.ts` turns the approved Core / Control Plane / Operations / Plugin / Application topology into an auditable, fail-closed report.

It does not rewrite files, move modules, merge code, or remediate findings automatically.

## Enforced boundaries

- Core dependencies must flow in pipeline order.
- Runtime remains the terminal real-time Core stage.
- Control, Operations, and Application modules cannot enter the real-time path.
- Plugins cannot depend directly on Portfolio, Risk, Execution, or Runtime.
- Operator applications cannot expose order submission, kill-switch release, LIVE enablement, private API use, or strategy promotion responsibilities.
- Risk must retain the kill-switch responsibility.
- Runtime must retain fail-closed behavior.
- Recorder remains append-only.
- Replay remains read-only.
- Committee retains a human-review gate.

## Severity

- `CRITICAL`: architecture or safety boundary violation.
- `HIGH`: required platform or safety contract missing.
- `MEDIUM` and `LOW`: reserved for later repository hygiene checks.

Any Critical or High finding produces `FAIL`.

## Safety

- `automaticRemediationAllowed` is always `false`.
- The audit has no execution, order, credential, withdrawal, release, or merge capability.
- The PR remains Draft.

## Next milestone

The next audit increment should map concrete source files to topology modules and add static import scanning without weakening existing tests or moving files prematurely.
