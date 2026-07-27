# Independent Paper Pilot Verifier

`scripts/lib/pilot-independent-verifier.js` independently seals and verifies every
Shadow and Canary pilot event. It deliberately does not import either runtime or a
runtime verification helper. It re-derives canonical hashes, chain continuity, session
identity, fingerprints, aggregate counts, and safety violations from the complete event
stream.

Evidence is explicitly one of `TEST_FIXTURE`, `DRY_RUN`, `SHADOW_OPERATIONAL`, or
`CANARY_OPERATIONAL`. Fixtures and dry runs validate code only; they are never counted
as operational observation. A Shadow operational session also proves zero actual broker,
order, fill, cash, and position mutation. Canary evidence checks approval sealing and
binding, command/order/fill linkage, duplicate or orphan fills, and unsafe continuation.

The verifier fails closed on unsupported schemas, altered hashes, source or fingerprint
mismatches, missing sequences, automatic restart/reconnect, reconciliation failure, P0,
or a prohibited capability. It creates no order and changes no runtime mode.
