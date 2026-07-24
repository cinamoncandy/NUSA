# Orderbook Imbalance Feature v1

Research #002 begins with a deterministic, read-only orderbook snapshot contract.

## Inputs

- immutable bid and ask levels
- strictly descending bids
- strictly ascending asks
- capture timestamp, optional sequence, and source provenance
- explicit depth, liquidity, spread, and staleness policy

## Outputs

- best bid and ask
- mid price and spread
- depth-weighted bid and ask quantity
- book imbalance
- top-of-book queue imbalance
- microprice and deviation from mid
- eligibility reasons
- canonical SHA-256 content hash

## Fail-closed rules

The feature rejects malformed timestamps, non-finite values, negative quantity, non-positive price, unsorted levels, crossed or locked books, invalid sequence values, and generation before capture.

Stale, thin, or excessively wide books are retained as deterministic observations but marked ineligible.

## Safety boundary

This module is research-only. It cannot submit orders, access credentials, call private exchange APIs, allocate capital, or promote a strategy. Any Strategy, Backtest, Walk-Forward, Stress, or Paper integration requires a separate reviewed module and CI coverage.
