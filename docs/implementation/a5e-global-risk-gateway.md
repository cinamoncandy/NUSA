# A5E Global Risk Gateway and Kill Switch

## Boundary

Every prospective execution is evaluated by `GlobalRiskGateway` before an orchestration layer may submit it. The gateway is fail-closed: invalid numeric input or an indeterminate dependency returns `UNKNOWN`, never `APPROVED`. `productionMutationAllowed` is a literal `false` in the capability descriptor.

## Rules

The policy evaluates global, strategy, and symbol exposure; expected fills are included with current positions, open orders, and partial fills. It evaluates realized plus unrealized daily loss, position count and size, and consecutive losses. It blocks unknown submissions, non-MATCH reconciliation, stale/disconnected/warming market data, credential errors, pending recovery, missing manual approval, and active global/exchange/strategy/symbol/session kill switches.

## Kill switch

Scopes are independent. A global switch matches every request; other scopes match only their exchange, strategy, symbol, or session key. Emergency conditions remain blockers and are recorded as reason codes. Reset behavior is outside A5E and must use the existing persisted operator procedure.

## Evidence

Every decision is appended to the supplied evidence sink with decision ID, policy version, ordered reason codes, timestamp, and execution ID. The sink contract is append-only; production wiring must use the existing immutable Evidence boundary.

## Integration boundary

This increment provides the gateway and a strict `assertSubmitAllowed` contract. Existing A5D orchestration should call `evaluate` immediately before submit and refuse the exchange port unless the result is `APPROVED`. The current production mutation capability remains disabled, so no real order can be submitted.
