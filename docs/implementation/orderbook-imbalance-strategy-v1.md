# Orderbook Imbalance Strategy v1

## Scope

`OrderbookImbalanceStrategy.ts` converts a validated `OrderbookImbalanceFeature` into a deterministic PAPER/DRY_RUN research decision.

Supported actions:

- `ENTER_LONG`
- `ENTER_SHORT`
- `EXIT`
- `HOLD`
- `ABSTAIN`

## Entry contract

Entry requires all configured directional thresholds to agree:

- depth-weighted book imbalance
- top-of-book queue imbalance
- microprice deviation
- maximum spread filter

No decision is generated from raw exchange data. The strategy consumes only the completed feature contract and preserves its hash and snapshot identity.

## Exit contract

Open positions exit on one or more of:

- adverse microprice stop
- imbalance mean reversion
- maximum holding snapshot count
- spread expansion
- feature ineligibility or liquidity failure

## Risk state

The state machine tracks:

- `FLAT`, `LONG`, or `SHORT`
- holding snapshot count
- cooldown remaining
- consecutive losses

The consecutive-loss guard blocks new entries after the configured limit. A trade outcome may be recorded only while flat.

## Determinism and audit

Every decision includes:

- strategy and feature versions
- feature SHA-256
- source snapshot ID
- reasons
- confidence
- next state
- canonical SHA-256 decision hash

Repeated evaluation with identical inputs produces an identical result.

## Safety boundary

This module contains no exchange adapter, private API call, credential access, capital allocation, automatic promotion, or LIVE order path. It is a research decision contract only.
