# Release Readiness Audit v1

Release Readiness Audit converts the Release Candidate checklist into a deterministic, read-only report.

## Scope

The audit checks:

- CI, typecheck, build, and full tests
- runtime, performance, and security audits
- recovery procedure and operator runbook
- minimum Paper validation duration
- unresolved critical and high findings
- PAPER/DRY_RUN boundary
- pull request draft recommendation

## Status

- `READY`: all required and advisory checks pass
- `CONDITIONAL`: required checks pass but advisory warnings remain
- `BLOCKED`: at least one required check fails

## Safety boundary

The module never deploys, merges, changes pull request state, enables Live trading, places orders, or accepts findings automatically. `automaticReleaseAllowed` is always `false`; owner review remains mandatory.

The default minimum Paper validation period is 30 days. This duration can be raised explicitly, but cannot be zero or negative.
