# ADR-0024: A holding-horizon floor for Upbit KRW spot

## Status

Accepted. Research measurement plus a guard; no strategy is promoted, no LIVE,
real-money, credential, or production-mutation surface is touched.

## Context

ADR-0023 showed the order-book imbalance alpha cannot pay a round trip, and that
whether ANY horizon covers the cost varied wildly between two 25-minute
recordings of the same market — a trending window covered it in four minutes, a
quiet one did not in fourteen. Twenty-five minutes cannot settle the question.

Order books have no history on Upbit, which is why ADR-0023 was limited to what
could be recorded live. Candles do. The same arithmetic therefore runs over
months instead of minutes, and that is enough to answer the question the
order-book work could only pose.

## Measurement

`scripts/alpha/measure-candle-horizon-economics.js`, 2000 hourly candles per
market ending 2026-09-10 (2026-06-18 onward, ~83 days). Movement is the median
ABSOLUTE return over each horizon — the take a perfect direction-caller would
collect — with the 25th percentile beside it, because a strategy has to survive
its quiet quarter, not only its median one. A round trip is 0.172%.

KRW-BTC:

| Horizon | Median move | Quiet quarter | Verdict |
|---|---|---|---|
| 1 h | 0.158% | 0.071% | below cost even at the median |
| 2 h | 0.222% | 0.102% | median only |
| 4 h | 0.302% | 0.135% | median only |
| **8 h** | **0.446%** | **0.202%** | **clears the quiet quarter** |
| 24 h | 0.815% | 0.357% | comfortable |
| 168 h | 2.217% | 0.882% | comfortable |

Across markets, the first horizon that clears the quiet quarter: **BTC 8 h,
ETH 8 h, XRP 4 h.**

## Decision

**Eight hours is the floor for a taker strategy on Upbit KRW majors.** Eight
rather than four, so a strategy is not sized to the easiest major.

`apps/cloud/src/alpha/horizonViability.ts` makes the arithmetic a check rather
than something a reviewer has to remember. `evaluateHorizonViability` returns
`VIABLE`, `MEDIAN_ONLY`, `COST_EXCEEDS_MOVEMENT` or `UNMEASURED`, and it fails
closed: a horizon whose movement was never measured is `UNMEASURED`, never a
pass. A strategy nobody did this arithmetic for is exactly the case the guard
exists for — the order-book alpha was built, tested, frozen and never questioned
on the point, and the numbers were available from the first day.

## What this settles about the existing strategies

The order-book imbalance strategy holds for seconds. Its horizon is four orders
of magnitude below the floor, and no threshold inside it can change that. It is
not a strategy that needs tuning; it is a strategy in the wrong regime for this
venue's cost structure.

The signal that actually reaches a live PAPER decision — the 24-hour change rate
in `upbitTickerObservation.ts` — sits at a horizon that clears the floor
comfortably. Whether it has edge is a separate and still-unanswered question, but
it is at least asking it where the economics permit an answer.

## Consequences

The floor is venue-specific and cost-specific. Upbit KRW spot charges 0.05% per
leg to makers and takers alike, so there is no rebate to earn and no execution
trick that removes the 0.1% fee component; only the 0.032% spread is avoidable,
by posting rather than crossing. A venue with maker rebates would have a lower
floor, and the constants in `UPBIT_KRW_SPOT_ROUND_TRIP` are the place to say so.

Eighty-three days is one season. The floor should be re-measured when volatility
regime changes materially; the script is the record of how.
