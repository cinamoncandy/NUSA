# Multi-Agent Decision Governance v0.1

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

## Deliberate Limits

This v0.1 does not implement an agent runtime, prompts, external provider
integration, agent conversation, automatic retries, model certification lookup,
incident workflows, certification issuance, dashboard, CLI, or historical
correlated-error statistics. Those additions must stay zero-authority, retain
the independent Risk veto, and preserve deterministic replay.
