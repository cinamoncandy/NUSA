# Liquidity Sweep Feature v1

Research #003 starts with a deterministic, fail-closed feature contract for directional liquidity sweeps.

The feature validates an uncrossed, strictly ordered public order book and derives:

- directional sweep side
- visible bid and ask notional
- aggressive trade notional
- consumed depth ratio
- spread rate
- price impact rate
- deterministic SHA-256 identity

A feature is ineligible when the snapshot is stale, spread is too wide, direction is unknown, notional is below policy, or consumed depth is insufficient.

Safety boundary: research and PAPER/DRY_RUN only. This module has no private API, credential, exchange order, capital allocation, or automatic promotion path.
