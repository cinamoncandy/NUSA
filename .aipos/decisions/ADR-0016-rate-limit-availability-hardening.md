# ADR-0016: Rate-limit availability hardening

## Status

Accepted. Repository implementation only; no LIVE, real-money, credential, or
production-mutation surface is touched.

## Context

The Cloud dashboard meters every non-`/health` request through
`BoundedHttpRateLimiter` (`apps/cloud/src/httpRateLimiter.ts`), which keys a
`DeterministicRateLimitManager` (`apps/execution/src/rate-limit-manager.ts`) per
`path|identity` bucket. Both registries were bounded but monotonic, and both
treated exhaustion as permanent:

1. `BoundedHttpRateLimiter.buckets` was capped at `maxBuckets` (256) and never
   released an entry. Bucket identity derives from the caller-supplied
   `Authorization` header, so a few hundred requests carrying distinct throwaway
   bearer values filled the registry. Every subsequent *new* identity — including
   the owner's — was then denied for the life of the process.
2. `DeterministicRateLimitManager.decisions` memoized each `requestId` decision
   forever, and returned `BLOCK` once `maximumTrackedRequests` (512) was reached.
   Because `requestId` is the per-request correlation id, ordinary owner traffic
   reached that ceiling on its own and the bucket then blocked permanently
   regardless of token refill.

Both behaviors were written as fail-closed memory bounds. In practice they
converted a bounded-memory guarantee into an unrecoverable denial of service
against the legitimate owner, reachable without any credential.

Separately, the limiter exempted `/health` by comparing the *normalized* path
while the request handler matched the *raw* URL. `/health?x=1` therefore skipped
metering and fell through to ordinary routing as an unmetered request.

## Decision

1. Add `DeterministicRateLimitManager.isIdle(nowMs)`. A bucket is idle only when
   it has refilled to capacity and holds no replayable decision.
2. `BoundedHttpRateLimiter` reclaims idle buckets when the registry is full, and
   only then admits a new identity. If no bucket is idle it still fails closed.
   A caller that is actively being throttled is never idle, so it cannot reset
   its own limit by flooding the registry with fresh identities.
3. Give memoized decisions a retention window (`decisionRetentionMs`, defaulting
   to `refillIntervalMs`). Expired entries are pruned before
   `maximumTrackedRequests` is enforced, so tracking capacity recovers with time
   instead of blocking a bucket permanently. Idempotent replay within the window
   is unchanged.
4. Narrow the `/health` metering exemption to the exact raw URL, matching the
   handler.
5. Accept a client-supplied `x-correlation-id` / `x-request-id` only in a bounded
   printable form (`[\w.:-]{1,128}`); otherwise generate one. The value is echoed
   into operational logs and keys the idempotency memo.

## Safety invariants

- `liveAuthority=NONE`
- `productionMutationAllowed=false`
- AI remains ZERO_AUTHORITY.
- Memory remains bounded: both registries keep their existing caps, and neither
  eviction path raises them.
- Throttling still fails closed. Eviction never returns tokens to a caller that
  is over its limit.

## Consequences

Registry exhaustion becomes a transient, self-healing condition instead of a
permanent lockout, while the anti-abuse and bounded-memory properties that
motivated the original caps are preserved. `decisionRetentionMs` is a new
optional policy field; existing policies keep their behavior through the
`refillIntervalMs` default.
