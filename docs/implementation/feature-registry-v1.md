# Feature Registry v1

## Purpose

Feature Registry v1 provides immutable, versioned definitions for quantitative features used by NUSA research, replay, and PAPER/DRY_RUN runtime paths.

It does not contain trading logic and cannot submit orders.

## Guarantees

- feature identity is `featureId@version`
- existing definitions are never mutated
- lifecycle changes create a new version
- runtime calculations require a validated or active definition
- future timestamps and stale values fail closed
- all calculations include engine version, input snapshot identity, source, and generation time
- historical retired definitions remain queryable
- dependency identities must already exist
- duplicate identities and duplicate dependencies are rejected

## Initial definitions

- funding z-score
- basis
- open-interest delta
- order-book imbalance
- microprice
- spread velocity
- realized volatility
- liquidation intensity

## Lifecycle

`DRAFT -> VALIDATED -> ACTIVE -> DEPRECATED -> RETIRED`

The registry does not mutate an existing definition to advance lifecycle. It derives and registers a new immutable version.

## Runtime boundary

The registry is populated through control/research workflows. Runtime access is read-only. Feature calculation validation checks lifecycle, freshness, finite values, provenance fields, and clock direction.

## Exclusions

- no private exchange API
- no credential handling
- no order submission
- no position sizing
- no automatic strategy promotion
- no LIVE trading
