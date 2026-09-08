# ADR-0019: Trading-safety fail-closed parity with established bots

## Status

Accepted. Repository implementation only; no LIVE, real-money, credential, or
production-mutation surface is touched.

## Context

NUSA's risk surface was compared against the protections that established
trading bots enforce — Freqtrade's `ProtectionManager` guards, Hummingbot's
price bands and oracle deviation limits, and the client-order-id uniqueness
rules every exchange applies at the API boundary.

Most of those protections are already present here, and several NUSA gates
(fingerprint identity, deployment integrity, sealed decision hashes) have no
counterpart in those projects. The comparison surfaced two places where a
declared protection did not hold under the conditions it exists for.

### 1. The price band was skipped exactly when it was needed

`packages/core/src/independentRiskGateway.ts` compares the caller's
`referencePrice` against the observed market price and rejects on
`PRICE_DEVIATION_LIMIT`. The comparison was guarded by `marketPrice != null`.

`PreTradeRiskRequest.marketDataState` is typed `{ status; price: number | null }`,
and structural validation accepts a `null` price under **any** status, `HEALTHY`
included. A feed reporting itself healthy while carrying no price therefore
passed validation, contributed no market-data reason code, and silently skipped
the band — the only check that would have caught a mispriced order, disabled at
precisely the moment the reference was unavailable.

This contradicts the invariant the module's own header states: *"A check skipped
for want of input is indistinguishable from a check that passed."*
`scripts/lib/paper-risk-gateway-verifier.js`, the independent re-implementation
used for cross-verification, carried the identical guard, so the two agreed with
each other while both failed open.

### 2. Duplicate-order suppression keyed on a 32-bit non-cryptographic hash

`apps/execution/src/order-admission.ts` decides, per idempotency key, whether a
resubmission is the same economic order (`DUPLICATE`) or a different one sent
under a reused key (`BLOCK`). That decision was keyed on an 8-hex-character
FNV-1a checksum of the intent. Two consequences:

- By the birthday bound, ~50% collision probability across roughly 77,000
  intents. A collision does not mislabel harmlessly: a genuinely different order
  is answered `DUPLICATE` and silently dropped.
- FNV-1a offers no resistance to a chosen-payload collision, so anyone able to
  influence intent fields can craft one.

Separately, the hashed encoding joined fields with `"|"` and no escaping. An
account id of `"a|b"` with strategy `"c"` encoded identically to account `"a"`
with strategy `"b|c"` — two economically distinct orders sharing one hash,
reachable without any collision search.

## Decision

1. In the gateway and in the verifier, a `HEALTHY` status carrying no price adds
   `MARKET_DATA_INVALID`. The band becomes unskippable: either a usable price
   exists and the deviation is checked, or the feed is recorded as unusable and
   the order is blocked. `MARKET_DATA_INVALID` is already declared and already
   covered, so no contract or reason-code change is required. Non-`HEALTHY`
   statuses keep emitting their own code and are not double-labelled.
2. `hashOrderIntent` uses SHA-256 over a length-prefixed (`<len>:<field>`)
   encoding. Length prefixing makes the encoding injective for any field
   content, and SHA-256 removes both the accidental and the crafted collision.

## Safety invariants

- `liveAuthority=NONE`
- `productionMutationAllowed=false`
- AI remains ZERO_AUTHORITY.
- Both changes move strictly toward blocking. Neither admits an order that was
  previously refused.

## Consequences

`payload_hash` in `order_idempotency_records` is a TEXT column with no width
constraint, so the wider digest needs no schema migration. Rows written before
this change no longer match a recomputed hash, so a key recorded under the old
function is answered `PAYLOAD_CHANGED_FOR_IDEMPOTENCY_KEY` rather than
`DUPLICATE`. That is the fail-closed direction — a refusal to act, not a
duplicate submission — and it affects only PAPER records already on disk.

`tests/trading-safety-fail-closed.test.js` covers both changes, including that
the gateway and the independent verifier reach the same decision on a healthy
feed with no price.
