# ADR-0021: Which layer actually guards a live PAPER order

## Status

Accepted. Documentation and test hardening only; no behaviour is changed by this
record, and no LIVE, real-money, credential, or production-mutation surface is
touched.

## Context

Reviewing this repository, two structural questions were nearly answered wrong,
both by reading one file instead of the chain it sits in.

**"The execution loop has no risk gate."** `paperTradingExecutionLoop.ts`
contains no reference to any gateway, which reads alarming until the caller is
followed: `runtime.ts` constructs `CloudPaperExecutionBoundary({ loop, riskGate:
productionPaperRiskGate })`, and the boundary calls `riskGate.evaluate()` before
it reaches the loop. The gate guards the live path from one layer up. That is
correct layering — the loop stays a mechanism and the boundary owns the policy —
but nothing in the loop says so, so each new reader re-derives it.

**"`apps/execution` is 79 modules of ceremony."** Twenty-two of them are named
for evidence, certification, attestation or receipts, against thirteen that carry
order logic, which reads as ritual outgrowing the thing it certifies. Following
the imports gives a different answer: `packages/storage` imports nine of those
modules as TYPES ONLY and five as values. `apps/execution` is largely a contract
layer — it declares the repository shapes that `packages/storage` implements.
Counting files there measures the schema, not the running code.

One finding survives the correction. `admitOrder` (`order-admission.ts`) is
called only by `execution-gateway.ts` in the same app, and nothing in
`apps/cloud` or `apps/desktop` calls that gateway. The execution app's order
admission pipeline is self-contained and is NOT what admits a live PAPER order;
the boundary above is.

## Decision

Record the layering, so the next reader does not have to rediscover it:

```
runtime.ts
  └── CloudPaperExecutionBoundary        <- risk gate evaluated HERE
        └── PaperTradingExecutionLoop    <- mechanism only, no policy
```

- `packages/core/src/independentRiskGateway.ts` is the single implementation.
  `apps/cloud/src/independentRiskGateway.ts` and
  `apps/desktop/src/risk/independentRiskGateway.ts` are one-line re-exports, not
  copies; there is no second gateway to drift.
- `scripts/lib/paper-risk-gateway-verifier.js` is a separate re-implementation
  used to cross-check decisions.
- `apps/execution` supplies contracts to `packages/storage`. Its own order
  admission and execution gateway are not in the live PAPER path.

## Consequences

Agreement between the gateway and its verifier is NOT evidence that either is
correct. Both were written by the same hand from the same understanding, and
both carried the same `marketPrice != null` guard, so they agreed with each other
while both failed open on the price band (ADR-0019). The coverage suite passed
throughout, because it proves each reason code is REACHABLE — an existence proof,
which a check that silently stops running still satisfies.

`tests/independent-risk-gateway-fail-closed-property.test.js` asserts the
property that cannot be satisfied by a fail-open implementation whoever wrote it:
starting from a request that is refused, removing or corrupting any single input
must never produce ALLOW. It walks every leaf of the request against null,
undefined, missing, NaN and Infinity, applies the same property to the policy
limits, and runs the verifier over every damaged case.

It was validated by reverting the ADR-0019 fix: the property test fails and names
`price deviation: marketDataState.price = null`, while the coverage suite still
reports 8/8. A test that cannot fail on the bug it exists for is not coverage.
