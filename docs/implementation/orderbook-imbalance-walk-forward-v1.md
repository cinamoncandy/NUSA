# Orderbook Imbalance Walk-Forward v1

## Scope

`OrderbookImbalanceWalkForward.ts` performs deterministic rolling or anchored walk-forward evaluation for the Orderbook Imbalance research strategy.

## Selection boundary

Candidate selection uses train-only fields:

- train return
- train Sharpe
- train maximum drawdown
- configured train eligibility gates and weights

OOS return, Sharpe, drawdown, and trade count are retained only after selection and cannot influence the selected candidate.

## Window invariants

- train and test ranges are strictly ordered and non-overlapping
- OOS windows cannot overlap
- rolling windows advance `trainStart`
- anchored windows retain one `trainStart`
- duplicate windows and duplicate candidates fail closed
- candidate parameter identities require SHA-256 hashes
- NaN and infinite metrics fail closed

## Aggregate output

The result reports positive OOS window ratio, mean OOS return and Sharpe, worst OOS drawdown, candidate switch ratio, parameter drift ratio, stability score, explicit pass/fail reasons, and a deterministic SHA-256 result hash.

## Safety boundary

This module is research-only and PAPER/DRY_RUN compatible. It does not place orders, access private exchange APIs, handle credentials, allocate capital, promote a Champion automatically, or establish profitability.
