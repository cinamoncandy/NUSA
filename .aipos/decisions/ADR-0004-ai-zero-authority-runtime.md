# ADR-0004: Model-Backed Zero-Authority Agent Runtime

Status: Accepted for implementation

## Decision

NUSA may connect a provider-agnostic model boundary to the existing deterministic
multi-agent governance runtime for PAPER/Research analysis. The model boundary
returns bounded, strictly validated structured conclusions and evidence
references. It does not receive raw application state or credentials.

Every AI result remains below deterministic safety and risk authority:

- `realOrderAuthority=false`
- `realTransferAuthority=false`
- `productionMutationAllowed=false`
- `liveAuthority=NONE`

The existing `evaluateMultiAgentDecision()` remains the decision boundary. A
model result cannot place, cancel, replace, or authorize an order; change risk,
kill-switch, or HALT state; access credentials; or promote a strategy.

## Failure behavior

Provider unavailability, timeout, malformed output, prompt digest mismatch,
fabricated/stale/conflicted evidence, missing critic output, replay conflict, or
governance failure produces an unavailable/incomplete/denied result and leaves
the PAPER execution state unchanged.

## Runtime composition

Cloud AI is default-off (`NUSA_AI_ENABLED=false`). The default provider is an
explicit unavailable provider until a separately approved provider integration
exists. Research agents may create draft/queued hypothesis or review records,
but automatic promotion is out of scope.

## Rejected alternatives

- Direct model calls from the execution loop.
- Passing complete runtime/account state to an agent.
- Treating a model recommendation as an order intent.
- Enabling a provider or credentials by default.
