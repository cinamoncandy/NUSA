# ADR-0010: Provider-Neutral N-Version Inference and Disagreement Governance

- Status: Proposed
- Date: 2026-08-09
- Scope: PAPER/Research zero-authority AI inference only

## Context

WO-AI-001 through WO-AI-006 established grounded structured inference, real-provider support, outcome-linked calibration, durable calibration replay, and shared inference resource governance. The fresh post-WO-AI-006 capability audit finds that provider/model diversity remains a critical intelligence limitation.

The runtime currently composes one configured provider/model into multiple logical agent roles. Role separation improves task decomposition, but it does not create independent model evidence when every role shares the same provider/model lineage and correlated failure modes. A superficially plural multi-agent result can therefore overstate independence.

WO-AI-006 now provides the prerequisite common resource boundary: model calls, retries, input bytes, output-token reservation and wall-clock duration are bounded and auditable. NUSA can add independent inference paths without losing control of resource use.

## Decision

NUSA will introduce provider-neutral N-version inference and disagreement governance before expanding scenario generation or autonomous learning.

1. Define an immutable versioned provider-pool policy containing configured provider/model groups and their declared independence lineage.
2. A result may claim cross-provider consensus only when at least two successfully completed groups satisfy explicit independence rules. Same provider/model lineage cannot be counted twice by aliases, role names, credentials, endpoints or duplicated configuration.
3. Comparable N-version runs must use the same canonical evidence snapshot, role contract, prompt/schema version, decision horizon and outcome semantics. Material mismatch makes comparison `UNVERIFIED` or `INCOMPLETE`.
4. Every provider attempt remains admitted through WO-AI-006 resource governance. Fan-out cannot bypass call, retry, byte, token or wall-clock ceilings.
5. Preserve provider/model/prompt/schema/input/resource-policy identity in immutable comparison evidence. Never persist credential material, authorization headers, raw secrets or hidden chain-of-thought.
6. Evaluate structured disagreement over decision/recommendation fields, raw probability, uncertainty, assumptions, evidence references and explicit failure/refusal state.
7. Expose explicit comparison states: `CONSENSUS | DISAGREEMENT | INSUFFICIENT_INDEPENDENCE | INCOMPLETE | UNVERIFIED`.
8. Consensus is evidence, not authority. Majority vote, unanimity or confidence aggregation cannot authorize PAPER mutation, strategy promotion, risk increase, production mutation or LIVE execution.
9. Disagreement must be allowed to reduce trusted confidence, force abstention or mark analysis incomplete. It may never be hidden by selecting whichever provider produced the preferred answer.
10. Partial provider failure, refusal, timeout, malformed output or resource exhaustion remains explicit. A surviving provider cannot be silently duplicated or promoted to fake consensus.
11. Replay must be idempotent and lineage-bound. Conflicting provider-pool policy, identity, prompt/schema/input or comparison evidence fails closed.
12. Provider-specific network adapters stay outside core contracts. Any concrete additional provider selected during implementation must be verified against its current official API contract and remain explicitly opt-in.
13. WO-0051 remains HUMAN_ENVIRONMENT_ONLY and cannot be satisfied or bypassed by this work.

## Consequences

- Multi-agent plurality becomes distinguishable from genuine independent model evidence.
- Correlated model/provider error becomes observable through disagreement rather than hidden behind role count.
- Later scenario, explanation-faithfulness and learning systems can consume a trustworthy independence/disagreement signal.
- Additional provider calls increase cost and latency, but WO-AI-006 bounds that increase and exposes it for net-benefit evaluation.
- NUSA gains a deterministic abstention path when independent models materially disagree.

## Non-goals

- No automatic provider/model winner selection for production authority.
- No provider output majority vote that can mutate PAPER or LIVE state.
- No strategy promotion or risk-limit mutation.
- No credential persistence in AI evidence.
- No hidden reasoning persistence.
- No vendor-specific monetary pricing table in core contracts.
- No scenario generator in this slice.
- No attempt to satisfy or bypass WO-0051.
