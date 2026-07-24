# Orderbook Imbalance Stress v1

`OrderbookImbalanceStress.ts` evaluates precomputed deterministic scenario observations against one explicit baseline.

## Scenario classes

- fee and slippage multipliers
- spread expansion
- snapshot latency
- liquidity reduction
- missing snapshots
- volatility amplification
- capacity changes

Exactly one `BASELINE` scenario is required. Every scenario must have exactly one observation.

## Outputs

The engine reports positive-scenario ratio, median and worst return, median and worst Sharpe, worst drawdown, median fill ratio, robustness, fragility, and grid-dependent break-even fee/slippage multipliers.

Candidate selection and scenario simulation remain outside this reducer. The reducer does not place orders, contact exchanges, access credentials, allocate capital, or promote a strategy.

## Safety and reproducibility

- malformed, duplicate, missing, or non-finite inputs fail closed
- results and nested scenario arrays are immutable
- output identity is a canonical SHA-256 hash
- PAPER/DRY_RUN research use only
