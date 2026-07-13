# Probability and Calibration Engine v1

## Purpose

Transforms a verified `MarketStateSnapshot` and versioned feature observations into a deterministic, replayable probability estimate. The engine does not submit orders, size positions, or bypass Risk.

## Inputs

- immutable Market State snapshot
- versioned features with normalized values, weights, quality, timestamp, and provenance
- historical calibration samples whose outcomes were known at evaluation time
- model version and explicit outcome definition
- minimum calibration sample count
- maximum uncertainty threshold

## Outputs

- raw probability
- calibrated probability
- confidence
- uncertainty
- abstain flag and reasons
- evidence contributions
- Brier score
- log loss
- expected calibration error
- sharpness
- reliability buckets
- sample size

## Safety and correctness

- Future market state, feature observations, and prediction timestamps are rejected.
- Outcomes occurring after the evaluation timestamp are excluded from calibration.
- Duplicate features and duplicate calibration samples are rejected.
- Invalid probabilities, non-finite values, and malformed timestamps fail closed.
- Insufficient OOS calibration evidence causes abstention.
- Liquidity-stress regimes always cause abstention.
- High uncertainty causes abstention.
- Returned estimates and nested evidence/metrics are immutable.

## Calibration semantics

The engine calculates standard probability-quality metrics over eligible historical samples. Calibration uses a deterministic ten-bucket empirical estimate with Laplace smoothing. This is a baseline contract, not a claim of predictive profitability.

## Explicit exclusions

- no order creation
- no private exchange API
- no credentials
- no LIVE activation
- no position sizing
- no automatic strategy promotion
- no guarantee of a 90% profitable-trade rate

The probability result is only one input to later Expected Value, Trade Permission, Capital, and Risk gates.
