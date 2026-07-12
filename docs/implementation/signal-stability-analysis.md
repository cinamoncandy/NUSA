# Signal Stability Analysis

This deterministic research check compares repeated strategy replays and overlapping signals produced from multiple warm-up start offsets.

It fails closed when:

- identical full replays differ;
- the same timestamp produces a different signal after the configured stabilization period;
- too few overlapping signals exist to support a conclusion;
- prices, timestamps, offsets, or configuration are invalid.

The analyzer complements the candle close-time contract and Walk-Forward train/OOS separation. It does not prove that a strategy has no bias, and untriggered signal branches remain unverified. A stable result is research evidence only; it does not authorize Paper promotion or guarantee profitability.

The approach adapts the failure model described by Freqtrade's lookahead and recursive-analysis documentation: compare behavior under controlled replay changes instead of trusting a single favorable backtest.

- https://www.freqtrade.io/en/stable/lookahead-analysis/
- https://www.freqtrade.io/en/stable/recursive-analysis/
