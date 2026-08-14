# Multi-Agent Decision Governance v0.2

## Scope and Authority Boundary

This is a deterministic, zero-authority analytical control plane. It does not
call an LLM, dispatch an order, transfer funds, read credentials, create a
runtime capability, or modify Risk, Execution, Treasury, Compliance, or Paper
Trading state. Every decision includes:

```text
realOrderAuthority = false
realTransferAuthority = false
productionMutationAllowed = false
```

`preview_candidate` is analytical input only. It is not approval or an order
intent. Existing authorization, compliance, risk, and Paper-only boundaries
remain mandatory and are intentionally not called by this module.

## Registry and Role Separation

`AgentDefinition` binds a role to a versioned model artifact, certification
identifier, prompt digest, schemas, context-isolation policy, timeout policy,
and correlated-error group. Capability names associated with orders, transfers,
credentials, live execution, or production mutation are rejected at registry
validation.

`AgentRoleContract` declares permitted and prohibited structured outputs.
The protected path requires distinct active Evidence Producer, Strategy
Proposer, and Risk Verifier definitions and active contracts. A Critic can be
included for adversarial review. Reused agent identities or correlated groups
make the path incomplete instead of creating false consensus.

## Evidence and Context

Evidence is immutable, content-addressed, freshness-aware, and lineage
preserving. Every fact/derived observation and every proposal/risk reference is
checked against the supplied evidence set. Missing references are treated as
fabricated references and force `deny`; stale, conflicted, or unsupported
evidence makes the decision incomplete.

Every required Agent Run uses a separate, agent-bound, hash-verified context
snapshot. Context snapshots cannot be shared across protected roles in one
decision. Expired, tampered, mismatched, or incomplete context fails closed.

## Deterministic Aggregation

There is no majority voting and no confidence weighting. The deterministic
order is:

1. Control-plane and Risk hard denies return `deny`.
2. Invalid role/run/schema/context/evidence/independence returns `incomplete`.
3. Critical unresolved disagreement or critical adversarial review returns
   `escalation_required`.
4. `no_action` or `insufficient_evidence` proposal returns `no_action`.
5. Only a verified, complete candidate becomes `preview_candidate`.

The Risk Verifier cannot be overruled by proposer confidence, critic agreement,
or retry behavior. Identical input produces the same decision hash.

## Calibration, Correlation, and Replay

The control plane exposes deterministic expected calibration error assessment
and correlated-group diagnostics. They are monitoring inputs, not decision
weights. Uncalibrated confidence is never used to grant safety authority.

Agent definitions, evidence, context snapshots, and final zero-authority
decisions can be written to an append-only SHA-256 event chain. Replay checks
sequence, timestamps, evidence hashes, immutable evidence, context hashes, and
authority flags. SQLite migration `007_multi_agent_governance` provides a
transactional ledger snapshot and non-authoritative query projections.

## Calibration History

`evaluateAgentCalibration` was, until this increment, a pure function that only ever saw
whatever observation batch its caller passed in for that one call -- there was no
accumulated track record. `AgentCalibrationObservationRecord` adds a durable, ledger-recorded
observation: `agentId`, `evaluationWindow`, `predictedConfidence`, `correct`, `recordedAt`,
and a required `sourceDecisionId`. The `sourceDecisionId` link is mandatory, not optional --
an observation can never be a free-floating, unauditable claim about an agent's track record.
Replay of `AGENT_CALIBRATION_OBSERVATION_RECORDED` fails closed if `sourceDecisionId` does not
already resolve to a decision already present in the ledger, or if `agentId` does not already
resolve to a registered agent; a duplicate `observationId` or a tampered `observationHash` is
likewise rejected. Accepted observations accumulate per agent in
`MultiAgentGovernanceReplayState.calibrationObservations`.

`deriveAgentCalibrationHistory` is a read-only projection over that accumulated history: it
filters the replayed observations to one agent/evaluation-window pair and calls the existing,
unmodified `evaluateAgentCalibration` on the result. It adds no new calibration math and does
not duplicate the AI runtime's separate, cohort-partitioned ECE/Brier calibration system
(`apps/cloud/src/ai/outcomeCalibration.ts`) -- that system serves a different vertical and was
deliberately left alone rather than adapted.

This increment does not decide how "correct" is determined, and it does not wire calibration
recording or `deriveAgentCalibrationHistory` into `multiAgentOrchestrator.ts`'s live decision
path. Outcome attribution -- judging whether a past proposal's confidence was actually correct
-- is a separate, comparably-sized governance question (on the same scale as the AI runtime's
outcome-attribution work) and remains future, separately-reviewed scope. Correlated-error
*history* is likewise still absent: `assessAgentIndependence` remains a point-in-time check
only, with no durable record of past correlated-failure occurrences.

## Incident Containment and Certification

An incident is an immutable factual record. Fabricated evidence, an attempted
Risk-veto override, context contamination, unauthorized capability use, schema
bypass, and trace loss are critical finding types. A deterministic containment
evaluation may recommend that affected Agents and the orchestration policy are
contained. It does not suspend an Agent, retry a run, alter a Policy, or mutate
runtime state itself.

Certification evaluates role separation, context isolation, evidence checks,
veto semantics, deterministic aggregation, calibration, correlated-error
assessment, replay, and evidence completeness. Every required control and
verified reference must pass. The only successful state is
`certified_zero_authority`; it still carries:

```text
realOrderAuthority = false
realTransferAuthority = false
productionMutationAllowed = false
```

Incident, containment, and certification events replay through the same
append-only chain. Any hash, authority flag, event/status mismatch, duplicate,
or missing incident is rejected fail-closed. The existing SQLite migration has
non-authoritative incident and certification projection tables, so this
increment needs no destructive schema migration.

## Deliberate Limits

This v0.2 does not implement an agent runtime, prompts, external provider
integration, agent conversation, automatic retries, model certification lookup,
automatic incident remediation, dashboard, CLI, or historical correlated-error
statistics. Those additions must stay zero-authority, retain the independent
Risk veto, and preserve deterministic replay.
