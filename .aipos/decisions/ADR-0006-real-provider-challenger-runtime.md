# ADR-0006: Real Provider Challenger Runtime

Status: Accepted for implementation

## Decision

NUSA will add an explicitly opt-in, zero-authority real model provider path so the grounded AI runtime can execute actual model inference without weakening any PAPER, safety, or human-only LIVE boundary.

The default provider remains unavailable. A real provider is selected only when AI is explicitly enabled and a provider is explicitly configured. Provider credentials are process-memory environment inputs only: they are never committed, persisted, placed in evidence, included in replay identity, returned by APIs, or written to logs.

The first application-owned adapter will use OpenAI's Responses API with strict JSON Schema Structured Outputs. The adapter remains behind the existing `ModelProvider` contract so future providers can be added as Champion/Challenger candidates without changing deterministic governance.

## Fresh AI capability audit

Scoring scale: 0 = absent, 5 = strong/verified.

- Evidence integrity: 5.0 / 5
- Replayability: 5.0 / 5
- Robustness / fail-closed behavior: 4.5 / 5
- Explanation quality: 2.5 / 5
- Latency / cost observability: 2.0 / 5
- Calibration: 1.0 / 5
- Provider diversity / real inference availability: 0.5 / 5

Provider diversity / real inference availability is the lowest safe dimension and is therefore selected before calibration. Calibration requires real model observations; it cannot be meaningfully promoted while the default composition always resolves to an unavailable provider.

## Provider boundary

- `createModelProviderFromEnvironment()` remains fail-closed unless an explicit supported provider is configured.
- `NUSA_AI_ENABLED=true` alone is insufficient to activate a network provider.
- Provider selection, model ID, endpoint policy, and timeout remain bounded application configuration.
- API keys are read from environment only and never become `AgentEvidence`, `AiEvidenceMaterialization`, prompt content, structured output, telemetry payload, or persistence state.
- The provider receives only the existing digest-bound sanitized evidence request and immutable prompt instructions.
- No provider tool calling, browsing, file access, code execution, broker access, order access, credential discovery, or external mutation capability is enabled.

## OpenAI challenger adapter

The initial adapter uses the Responses API with strict JSON Schema output. It must:

- send the exact digest-bound prompt instructions and evidence-only input;
- request only the schema required by the current agent role;
- parse only completed structured output;
- fail closed on refusal, incomplete response, malformed output, schema mismatch, HTTP/network error, timeout, model mismatch, or oversized output;
- map token usage into the existing non-secret `ModelUsage` contract;
- never persist raw request/response bodies or provider credentials;
- never expose provider chain-of-thought or hidden reasoning.

## Challenger semantics

A newly configured real provider is a challenger, not an authority source. Same-provider/same-model role runs remain correlated and are never counted as independent consensus. Provider/model identity remains replay-bound. Later provider diversity work may add additional challengers, but only after independent exact-head verification.

## Runtime authority

Unchanged hard invariants:

- `liveAuthority=NONE`
- `realOrderAuthority=false`
- `realTransferAuthority=false`
- `productionMutationAllowed=false`

Deterministic governance, Risk Governor, P0 state, HALT, kill switch, PAPER execution, and WO-0051 human/environment gates remain authoritative. A successful model response can produce only read-only analysis artifacts and a zero-authority preview candidate.

## Next evolution

After enough real challenger observations exist, the next audit should prioritize calibration: outcome linkage, expected calibration error, reliability buckets, model/prompt/version stratification, and conservative confidence projection. No automatic model-weight update or strategy promotion is authorized by this ADR.
