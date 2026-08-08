# ADR-0005: Grounded Trustworthy AI Runtime Activation

Status: Accepted for implementation

## Decision

NUSA will upgrade the existing zero-authority model runtime from metadata-only analysis wiring to a grounded, replayable, read-only AI analysis runtime.

Every model request must be bound to content-addressed sanitized evidence payloads and to the exact prompt body that produced the request. A digest without the materialized payload or prompt body is insufficient evidence for a trusted run.

The Cloud runtime may execute AI analysis asynchronously on a bounded cadence and expose only the latest validated result through the existing read-only Personal PAPER Operations snapshot. AI execution must never block, erase, or mutate PAPER execution state.

## Trust requirements

- Every materialized evidence payload is canonicalized and its SHA-256 must equal the corresponding `AgentEvidence.contentDigest`.
- Prompt artifact digests bind the complete role instructions plus schema/capability metadata, not only artifact IDs.
- Replay identity binds evidence, materialized payloads, provider/model identity, prompt digest, policies, certifications, control-plane state, context validity, and role.
- Agents sharing the same underlying model/provider/correlated group are treated as correlated analysis, never independent consensus.
- Uncalibrated model output never projects synthetic 1.0 confidence.
- Stale, missing, malformed, tampered, or provider-unavailable results fail closed to `UNAVAILABLE` or `INCOMPLETE`.

## Runtime boundary

AI remains advisory and read-only:

- `realOrderAuthority=false`
- `realTransferAuthority=false`
- `productionMutationAllowed=false`
- `liveAuthority=NONE`

The deterministic governance, Risk Governor, kill switch, HALT, P0 state, and PAPER execution loop remain authoritative. AI cannot place/cancel orders, access broker credentials, release safety controls, increase risk, promote strategies, or authorize LIVE behavior.

## Provider evolution

The runtime remains provider-neutral. Model/provider candidates are evaluated as Champion/Challenger components under `docs/NUSA_AI_EVOLUTION_PRINCIPLE.md`; no vendor/model gains authority merely by being newer or more capable. Provider credentials are never committed or persisted by this slice.

## Rejected alternatives

- Sending evidence IDs/digests to a model without the verified underlying payload.
- Hashing prompt metadata while leaving the actual instructions outside the digest.
- Calling four roles on one model and counting them as four independent votes.
- Returning confidence 1.0 solely because deterministic governance emitted `preview_candidate`.
- Running model inference inline in the PAPER fill path.
- Giving an AI provider order, transfer, credential, risk, kill-switch, HALT, or LIVE authority.
