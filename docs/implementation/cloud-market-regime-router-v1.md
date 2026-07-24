# Cloud Market Regime Router v1

This module is the runtime CIO/Investment Committee regime layer. It is intentionally separate from the desktop research timeline classifier.

## Responsibilities

- classify normalized runtime features into a deterministic market regime
- reject malformed or time-reversed inputs
- record whether the regime changed
- produce a fail-closed strategy policy
- disable new exposure during PANIC, RISK_OFF, and LONG_SQUEEZE
- reduce exposure in BREAKOUT, SHORT_SQUEEZE, and HIGH_VOL
- allow mean reversion and funding carry only in compatible regimes

## Boundaries

- PAPER/DRY_RUN only
- no exchange adapter
- no live order path
- no credentials or withdrawal capability
- no profitability guarantee
- low-confidence or unstable classifications reduce exposure

The existing desktop regime timeline remains the research/backtest classifier. This cloud module consumes already-normalized runtime features and routes strategies for the CIO layer.
