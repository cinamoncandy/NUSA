# ADR-0018: Deterministic policy approval for PAPER challengers

## Status

Accepted by the owner on 2026-09-24 (explicit choice of "policy auto-approval, boundary
relaxation" over owner-per-candidate approval). PAPER only. No LIVE, real-money, credential,
broker-mutation, or production-mutation authority is granted. AI authority stays ZERO.

## Context

`PaperChallengerDeploymentRuntime.deploy()` (#1605, commit `71acc6cc`) requires a canonical
Strategy Governance authorization before any PAPER binding or period exists, and accepted only
`actorType: "HUMAN"` approvals. The production composition root
(`closedLearningProductionRuntime.ts`) never supplied that port, and no production implementation
of it existed. Consequences on latest main:

1. A Research-qualified candidate could never reach PAPER, so the PAPER learning loop could not
   close.
2. The first qualified candidate would throw `PAPER_CHALLENGER_GOVERNANCE_APPROVAL_UNAVAILABLE`
   inside the closed-learning tick, whose fail-closed handler stops the whole PAPER runtime; the
   restart would hit the same point again.
3. A qualified cycle that did not deploy left the rollover without an open PAPER period.

## Decision

- Add `actorType: "POLICY"` as a second approver for **PAPER challengers only**, accepted by the
  deployment runtime only under the `policy:` approval-reference namespace. `AI`/`HYBRID` remain
  rejected: a model still cannot approve anything into execution.
- `PaperChallengerPolicyApproval` (`paper-challenger-policy-v1`) is deterministic code. It approves
  a candidate only when its immutable qualified Research artifact is stored, carries PAPER-only
  authority, has a strategy identity matching the requested family and version, and has valid
  Research lineage bound to the same decision reference. It re-reads the artifact rather than
  trusting the caller. Qualification (OOS, DSR, PBO, regime, League) remains the Research gate; the
  policy is the separate authorization step.
- The policy is **off by default**. It is enabled only by
  `NUSA_PAPER_CHALLENGER_POLICY_APPROVAL=ENABLED` on the PAPER host. Disabled means no approval
  exists.
- A missing approval is a wait, not a fault: bootstrap returns `WAITING_GOVERNANCE_APPROVAL`, the
  coordinator keeps the qualified decision recorded without a deployment (resumable), and the
  rollover keeps PAPER running on the current candidate. Every other deployment fault (identity,
  lineage, lifecycle, authority mismatch) still fails closed.

## Consequences

- With the switch enabled, a qualified candidate becomes a PAPER CHALLENGER without a human
  step. Promotion to CHAMPION, capital allocation, and anything LIVE are unaffected and keep
  their existing owners.
- HUMAN approval remains valid through the same port for any future owner-command path.
- Reverting is setting the switch off; already-bound challengers keep their immutable binding and
  are replaced or revoked only through the existing PAPER binding machinery.
