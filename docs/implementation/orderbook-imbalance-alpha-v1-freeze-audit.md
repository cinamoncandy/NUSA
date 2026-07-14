# Orderbook Imbalance Alpha v1 Freeze Audit

## Scope

The v1 research contract contains six modules:

1. Feature
2. Strategy
3. Backtest
4. Walk-Forward
5. Stress
6. Paper

## Frozen invariants

- chronological orderbook snapshots only
- decisions execute no earlier than the next snapshot
- deterministic hashes and replay
- invalid or ambiguous state fails closed
- Paper or Dry Run only
- no private exchange API
- no credential access
- no live order path
- no automatic Champion promotion

## Change policy

Breaking API changes require a version increase. Metric semantic changes require a new audit. Data contract changes require migration planning. Any execution-model change requires complete backtest, Walk-Forward, Stress, and Paper revalidation. Safety boundaries cannot be relaxed within v1.

## Audit conclusion

The implementation is frozen for research validation, not approved for profitability claims, live capital deployment, automatic promotion, or PR merge. Champion eligibility remains evidence only and still requires owner review.
