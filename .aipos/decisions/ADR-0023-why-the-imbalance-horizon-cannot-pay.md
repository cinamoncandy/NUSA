# ADR-0023: Why the order-book imbalance horizon cannot pay its costs

## Status

Accepted. Research measurement and tooling; no strategy is promoted, no LIVE,
real-money, credential, or production-mutation surface is touched.

## Context

ADR-0022 recorded the first measurement of the order-book imbalance alpha: 21
trades, no winners, and a loss whose size matched the round-trip cost. The
obvious next hypothesis was that the holding period was simply too short, and
that lengthening it would let the signal capture more than a round trip costs.

Two new instruments were built to test that, rather than searching for a
parameter that happened to win on one dataset:

- `scripts/alpha/measure-cost-vs-movement.js` compares what a round trip costs
  against the median ABSOLUTE price change over each candidate horizon. Absolute
  movement is what a perfect oracle — one that always picked the correct
  direction — would collect. Where cost exceeds it, no signal rescues the
  horizon and measuring signal quality is wasted work.
- `scripts/alpha/diagnose-holding-horizon.js` reports gross edge, cost and trade
  count across a range of holding caps, with a random-direction control at each.
  The control keeps every entry moment, hold and exit rule and flips only the
  SIDE, so "the signal's direction is informative" can be told apart from
  "anything entering here looks like this". The whole curve is reported;
  selecting the best cell from a sweep on one dataset would be selection, not
  evidence.

## The round trip

Measured on recorded books, per 1,000,000 KRW of notional:

| | KRW-BTC | KRW-ETH |
|---|---|---|
| Spread (median, paid twice as a taker) | 318 | 298 |
| Taker fees, 0.05% × 2 | 1,000 | 1,000 |
| Slippage, 0.02% × 2 | 400 | 400 |
| **Round trip** | **1,718 (0.172%)** | **1,698 (0.170%)** |

The spread line is easy to miss and is the reason a "gross" loss looked like a
signal failure. The backtest fills a BUY at the best ask and a SELL at the best
bid, so a taker pays the whole spread INSIDE `grossPnl`, where it appears in
neither the fee nor the slippage column.

## Where movement covers the cost — and why that moves

Median absolute mid-price change against the same round trip, measured on two
sessions of different character.

**Session A — 7 minutes, KRW-BTC trending (+0.354% over the window):**

| Horizon | Oracle take | Cost / take |
|---|---|---|
| ~60 s | 356 | 4.85 |
| ~2 min | 955 | 1.81 |
| ~4 min | 2,800 | **0.62 — covered** |

**Session B — 25 minutes, both markets quiet:**

| Horizon | BTC take | ratio | Horizon | ETH take | ratio |
|---|---|---|---|---|---|
| ~27 s | 14 | 101 | ~17 s | **0** | — |
| ~3.5 min | 169 | 8.44 | ~2 min | 298 | 5.70 |
| ~7 min | 319 | 4.47 | ~4.5 min | 298 | 5.70 |
| ~14 min | 352 | 4.05 | ~18 min | 1,193 | 1.42 |

**The crossover is a property of the regime, not of the market.** In the
trending session BTC covered a round trip at four minutes. In the quiet session
the same market did not cover it within fourteen, and ETH did not within
eighteen. Two readings of BTC minutes apart differ by a factor of eight at
comparable horizons.

An earlier draft of this record reported the four-minute crossover as though it
were a fixed property, because it was written from the trending session before
the longer one finished. It is not. A strategy sized to the trending session's
economics would be underwater through the quiet one, and quiet is the ordinary
state.

Two smaller facts are worth keeping. On ETH at ~17 seconds the median absolute
move is **zero** — more than half the time the mid price does not move at all
over the interval this strategy trades in. And BTC's take was identical at 3.5
and 7 minutes in the quiet session: the price went nowhere between them.

## Why raising the holding cap does not reach it

Diagnostic over 1,054 fresh BTC snapshots, `maximumHoldingSnapshots` from 20 to
320:

| Cap | Trades | Win rate | Gross/trade | Cost/trade | Beats coin flip |
|---|---|---|---|---|---|
| 20 | 16 | 0 | −493 | 1,378 | 0.75 |
| 80 | 11 | 0 | −446 | 1,432 | 0.85 |
| 160 | 10 | 0 | −414 | 1,435 | 0.85 |
| 320 | 9 | 0 | −403 | 1,439 | 0.90 |

Gross per trade is flat. Raising the cap by sixteen times moves it by 90 KRW,
and it stays close to the spread the round trip pays. The cap is not what ends
these trades — `exitImbalanceAbsolute` and the microprice stop fire within
seconds, so positions close long before the cap is reached and the four-minute
horizon is never actually held.

The direction the signal picks does carry some information: it beats 75–90% of
coin-flip controls. That is a real signal and it is nowhere near large enough,
being worth tens of KRW against a 1,718 KRW round trip.

## Decision

Record the measurement and stop tuning this configuration. Three facts now
constrain any further work on this alpha:

1. A taker round trip costs about 0.17% on Upbit KRW spot, and that is fixed.
2. Whether price moves that far depends on the regime, not the horizon alone. A
   trending session covered it in four minutes; a quiet one did not in fourteen.
3. The signal's own exit rules close positions within seconds, so even the
   horizons that sometimes pay are unreachable by raising the holding cap.

Reconciling those requires changing what the strategy IS, not its thresholds:
holding through the exit conditions to a horizon where movement exceeds cost —
at which point order-book imbalance, a seconds-scale signal, is unlikely to still
predict anything — or entering as a maker so the spread is earned rather than
paid, which removes 637 KRW of the 1,718 and still leaves fees above the take at
every horizon under two minutes.

## Consequences

Both datasets are single sessions of one venue in one regime, and trade counts
are in the tens. This does not establish that order-book imbalance has no edge on
Upbit. It establishes, with the arithmetic shown, that this configuration cannot
pay its costs and that no threshold search inside it will change that — which is
the question ADR-0022 left open.
