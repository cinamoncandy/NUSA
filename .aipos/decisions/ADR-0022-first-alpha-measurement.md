# ADR-0022: The first measured result from the order-book imbalance alpha

## Status

Accepted. Research tooling and one recorded measurement; no strategy is promoted,
no LIVE, real-money, credential, or production-mutation surface is touched, and
nothing here changes what the running system does.

## Context

`apps/cloud/src/alpha/orderbook/` held a complete research pipeline — feature,
strategy, backtest, walk-forward, stress and freeze — with tests, and
`alphaEvidenceRegistry.ts` defined how an alpha's evidence should be recorded.

Nothing had ever fed any of it. `OrderbookImbalanceFeature` was constructed
nowhere outside its own folder, `evaluateOrderbookImbalanceStrategy` was called
from no execution path, the registry held zero alphas and zero evidence, and no
backtest result existed anywhere in the repository. The only signal reaching a
live PAPER decision came from `upbitTickerObservation.ts`: a 24-hour change rate
weighted by turnover, which is momentum, not microstructure.

So the evaluation framework — multiple-testing correction, dependence groups,
point-in-time regime labels, frozen selection, abstention, calibration sample
counts — had never scored anything. An elaborate marking scheme, and no exam sat.

## Decision

Wire the pipeline to real data and record what it says.

- `scripts/alpha/collect-orderbook-snapshots.js` records public Upbit order books
  into the `OrderbookSnapshot` shape the feature already expects. Depth cannot be
  backtested from history — Upbit publishes the current book and no archive — so
  a dataset has to be recorded going forward.
- `scripts/alpha/run-orderbook-imbalance-backtest.js` runs snapshots through the
  existing feature, strategy and backtest modules and reports the metrics.

## First measurement

KRW-BTC, 2026-09-09T14:23:26Z to 14:30:25Z, 561 snapshots at ~0.7s.

| | |
|---|---|
| Features / eligible | 543 / 543 |
| Trades | 21 |
| Win rate | **0** |
| Gross PnL | −12,848 KRW (negative before costs) |
| Fees + slippage | 22,246 KRW |
| Net return | **−0.3544%** |
| BTC over the same window | **+0.3544%** |

The strategy returned an almost exact mirror of the market's own move.

The cause is arithmetic rather than a verdict on the signal. Over that window the
entire high-to-low range was 0.39% and the average spread 0.033%, while a round
trip costs 0.14% (0.05% taker fee and 0.02% slippage, each paid twice). With
`maximumHoldingSnapshots` at 20 — roughly 15–25 seconds — the move available to
capture is on the order of 0.02–0.05%. **The edge required is three to seven
times the movement the horizon offers.** No parameter search over entry
thresholds fixes that; the holding period is structurally incompatible with the
cost structure.

## Data integrity

Upbit's REST order book is not monotonic: roughly 3% of polls returned a book
older than the one just served (18 of 561). Such snapshots are DROPPED, never
reordered. Sorting them into place would manufacture a sequence the market never
presented, and a live strategy reading the feed in arrival order would not have
acted on them either. The backtest refuses non-chronological input, which is how
this was found.

## Consequences

This is one 7-minute window of one market in one regime, and 21 trades. It does
not establish that the signal has no edge. It does establish, quantitatively,
that the current parameterisation cannot profit at Upbit's cost structure, and
that is the first thing this project has actually measured about its own alpha.

Before any further work on this strategy, the horizon must be reconciled with the
cost: either hold long enough that the expected move exceeds 0.14%, or find an
execution path that does not cross the spread twice. Recording more data at the
current parameters would only measure the same arithmetic more precisely.
