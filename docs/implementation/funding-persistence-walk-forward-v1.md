# Funding Persistence Walk-Forward v1

## Purpose

Deterministic PAPER/DRY_RUN-only validation for the Funding Persistence mean-reversion candidate.

## Modes

- `ROLLING`: the train window start must advance.
- `ANCHORED`: the train window start remains fixed while the train end expands.

## Selection rule

Each window contains candidate train and test metrics. Candidate selection uses only the configured train metric (`SHARPE`, `CALMAR`, or `TOTAL_RETURN`). Test metrics are never used for selection.

## OOS gates

Each selected candidate is evaluated against:

- positive OOS total return;
- minimum OOS Sharpe;
- maximum OOS drawdown.

Aggregate validation also checks:

- positive-window ratio;
- candidate-switch ratio;
- mean OOS Sharpe;
- worst OOS drawdown;
- whether any individual window failed.

## Stability

The stability score combines positive-window ratio, candidate stability, mean OOS Sharpe, and drawdown headroom. It is a research diagnostic, not a profitability guarantee.

## Fail-closed validation

The engine rejects duplicate candles, duplicate windows, overlapping train/test ranges, overlapping OOS windows, invalid rolling/anchored progression, missing candidates, duplicate candidate IDs, invalid timestamps, mixed markets, and invalid policy values.

## Outputs

- immutable per-window results;
- selected candidate identity;
- train and OOS metrics;
- explicit pass/fail reasons;
- aggregate OOS statistics;
- deterministic SHA-256 result hash.

## Safety boundary

No order submission, private exchange API, credential access, capital allocation, automatic promotion, or LIVE path exists. Champion promotion still requires stress testing, Paper Trading, governance review, and owner approval.