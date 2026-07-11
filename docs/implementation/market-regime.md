# Market Regime v1

`marketRegime.ts` provides a deterministic, rule-based market classification layer for Research Lab experiments.

## Boundaries

- A regime is a classification produced by explicit thresholds, not an objective market fact.
- Only completed candles are used. Each output point uses the candle `closeTime` and `close`.
- Classification at timestamp `t` uses candles available at or before `t`; future candles cannot alter prior labels.
- The initial lookback period is reported as `UNKNOWN` rather than filled or inferred.
- Missing or unusable volume evidence produces `UNKNOWN` liquidity.
- The classifier does not enable, disable, or size trades.
- Regime transitions are observations, not trading signals.

## Dimensions

The v1 classifier keeps three dimensions separate:

- trend: `UP_TREND`, `DOWN_TREND`, `RANGE`, `UNKNOWN`
- volatility: `LOW_VOLATILITY`, `NORMAL_VOLATILITY`, `HIGH_VOLATILITY`, `UNKNOWN`
- liquidity: `LOW_LIQUIDITY`, `NORMAL_LIQUIDITY`, `HIGH_LIQUIDITY`, `UNKNOWN`

Thresholds, lookbacks, minimum samples, and `classifierVersion` are explicit inputs. Their canonical SHA-256 identity changes when any of those inputs changes.

## Limitations

- No funding, order-book, macro, sentiment, or on-chain evidence is included.
- Volatility thresholds are absolute configuration values; no future full-dataset percentile is used.
- Liquidity is represented by current volume relative to a past-only rolling mean.
- Classification does not prove profitability or future robustness.
- Regime-attributed OOS metrics and parameter-neighbor stability remain follow-up work.
