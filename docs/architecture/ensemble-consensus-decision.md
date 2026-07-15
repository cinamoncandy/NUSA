# Ensemble Consensus Decision Contract

## Status

Architectural input for the Decision Domain roadmap. This document does not enable trading and does not claim profitability.

## Product principle

Dokkaebi must not treat one model, one indicator, or one agent as an authority. A trade candidate is the result of a bounded committee process that can also abstain.

The committee answers a narrower question than "what will the market do?":

> Given the current evidence, risk limits, market state, and execution constraints, is there enough agreement to permit a Paper action?

Prediction and authorization are separate. A directional opinion never bypasses risk, persistence, market-integrity, or execution gates.

## Decision inputs

Each committee member returns a structured ballot:

- member identifier and version
- target market and evaluation timestamp
- proposed action: LONG, SHORT, EXIT, HOLD, or ABSTAIN
- normalized support score
- evidence references
- invalidation conditions
- data freshness and provenance
- optional diagnostic confidence

Confidence is diagnostic only. It must not be described as a probability of profit unless independently calibrated and validated.

## Quorum and authorization

A configurable policy defines:

- eligible member count
- minimum responding quorum
- minimum agreement threshold
- maximum stale or failed members
- action-specific thresholds
- conflict and abstention behavior

The initial contract must not hard-code claims such as 31 members or 26 votes. Those values are policy examples, not validated defaults.

A candidate is rejected when:

- responding quorum is not met
- agreement threshold is not met
- contradictory high-severity evidence exists
- data freshness or provenance fails
- risk, persistence, integrity, or execution gates fail
- the committee result cannot be reproduced from recorded inputs

No decision is a valid and expected outcome. The system must prefer abstention over forced activity.

## Independence and correlation

Counting several highly correlated variants as independent votes creates false consensus. Committee policy must record member families and cap correlated influence.

Examples of member families include:

- trend
- mean reversion
- volatility and regime
- market microstructure
- liquidity and execution quality
- risk and portfolio constraints
- anomaly and integrity checks

Risk, integrity, and execution members may act as veto gates rather than directional voters.

## Decision lifecycle

1. Capture an immutable market snapshot and provenance.
2. Evaluate eligible committee members against the same snapshot.
3. Normalize and validate ballots.
4. Apply independence, quorum, and agreement policy.
5. Apply risk, persistence, integrity, and execution gates.
6. Produce APPROVED_PAPER_ACTION, HOLD, ABSTAIN, or BLOCKED.
7. Persist the complete decision record before any Paper execution.
8. Link orders, fills, position changes, and later outcomes to the decision.

## Audit record

Every decision record must include:

- decision ID and policy version
- input snapshot identity and checksum
- all ballots, including failed and abstaining members
- quorum and agreement calculations
- vetoes and blocking reasons
- final action and human-readable rationale
- linked Paper order and fill IDs
- timestamps and code versions

The UI must show both agreement and disagreement. It must never reduce the result to a decorative confidence percentage.

## Market cadence

Five-minute evaluation may be supported as one policy, but the architecture must not assume it is universally appropriate. Cadence is explicit, versioned, and tied to the market-data contract. Missing or late intervals produce HOLD or BLOCKED rather than synthetic certainty.

## Safety boundaries

- Paper-only until independently promoted through the existing release process.
- No private exchange API or live order path is authorized by this document.
- Committee approval cannot override kill switch, risk limits, persistence failure, integrity failure, or stale data.
- Binance Futures support must add futures-specific margin, mark-price, funding, liquidation, and reduce-only gates before committee actions can be executed in Paper Futures.

## Roadmap placement

This contract belongs to the Decision Domain phase. UI/UX Foundation should only prepare honest states for loading, no quorum, abstention, disagreement, blocked, stale data, and approved Paper action. Implementation follows after the current UI state-system task is reviewed and accepted.
