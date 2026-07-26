# Release Decision

## Decision

- Candidate SHA: `4e5ce810919cb123c7055e3095222fd7e9353434`
- Artifact SHA-256: not applicable -- no packaged artifact exists for this candidate
- Version: `package.json` version field unchanged by this decision; no version bump performed
- Signed status: not signed; no signing has ever been attempted for this candidate
- **Decision: BLOCKED**
- Approved by: none (owner approval not sought or granted for this candidate)
- Approved at: not applicable
- Scope: not applicable -- no distribution stage is authorized
- Conditions: see "Path to RELEASE_CANDIDATE" below

Full gate-by-gate reasoning is in [`docs/release/desktop-release-gate.md`](./desktop-release-gate.md).

## Blocking issues

No P0 (safety-critical) or P1 (functional-critical) issues were *found*, because
the acceptance work that would surface them (packaged Smoke launch, NSIS
install/uninstall lifecycle, real Windows GUI acceptance, Paper Trading
scenario acceptance against a packaged build) has not been run yet. Absence of
a finding here is not evidence of safety -- it is evidence that the check
itself is missing. That gap is the blocking condition.

## Residual risk

Not assessed. A residual-risk register presumes a candidate close enough to
release that specific risks (installer reputation, WebSocket stability, DPI
layout, etc.) are worth weighing against release value. That tradeoff does not
apply yet -- there is no signed, Smoke-tested, GUI-accepted candidate to weigh
it against.

## Deployment plan

None. No distribution channel, pilot stage, or user scope is authorized by
this decision.

## Rollback

Not applicable yet. Rollback presumes a previously distributed, validated
version to fall back to. No version of this Electron desktop app has ever
been distributed, so there is nothing to roll back *from* or *to*. A rollback
runbook is real, useful work -- but it belongs with the first actual signed
release candidate, not as a hypothetical exercise now, and it is called out
explicitly as remaining work below rather than fabricated as a generic
template.

## Path to RELEASE_CANDIDATE

In work-order terms, everything from WO-0007 onward needs to actually be
implemented, tested, committed, pushed, and CI-verified, in order, before this
judgment can move past BLOCKED:

1. WO-0007 startup diagnostics
2. WO-0008 renderer crash-loop circuit breaker
3. WO-0009 single-instance lock
4. WO-0010 graceful shutdown
5. WO-0011 packaged runtime file validator
6. WO-0012 package contents minimization
7. WO-0013 Windows CI packaging + artifact validation
8. WO-0014 packaged offline Smoke launch
9. WO-0015 NSIS install/uninstall Smoke
10. WO-0016 Authenticode + artifact manifest readiness
11. WO-0017 protected production signing workflow (requires an owner-provided
    certificate that does not exist yet -- this step cannot complete without
    the owner supplying it)
12. WO-0018 real Windows GUI acceptance (requires a physical or VM Windows
    environment -- this agent's sandbox has no display and cannot perform it)
13. WO-0019 Paper Trading scenario acceptance against the packaged build

Only after all of the above have real, linked, CI-verifiable evidence does a
gate re-assessment become meaningful. Re-running this WO-0020 judgment before
then would only reproduce the same BLOCKED result.

## Owner approval

- Approval: **PENDING** (not requested as part of this pass)
- Approver: none
- Conditions: n/a
- Approved at: n/a

## PR status

- Draft: retained (unchanged)
- Ready: not applicable -- not requested, not warranted
- Merge: not performed, not requested

This matches PR #1's own existing release-gate statement
("`BLOCKED pending real scenario evidence and owner review`"), which this
decision does not override or contradict -- it is consistent with it, backed
by an itemized gate matrix instead of a summary line.

## Release

- Tag: not created
- GitHub Release: not created
- Distribution: none performed or scheduled
