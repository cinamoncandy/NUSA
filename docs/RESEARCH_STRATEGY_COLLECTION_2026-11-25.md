# Existing strategies collected: what was already tested, what is not (2026-11-25, proposal)

Status: **collection only. Not a pre-registration. Nothing was run and no data value was read.** PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`. No gate, threshold, risk limit, capital or authority is touched. Spot only (owner: 현물에 집중). Codex's L1-L8 work is not touched.

Korean summary (한 줄): 널리 알려진 전략 97가지는 이미 시험했고 통과 0이었다. 아래는 아직 안 시험한 알려진 계열의 목록이며, 과거 차트는 이미 다 봤으므로 판정은 앞으로 쌓일 데이터로만 한다.

## 1. Already tested (do not repeat)
| Source | What | Result |
|---|---|---|
| `RESEARCH_NOTE_2026-10-13_STRATEGY_CATALOG.md` | 97 well-known close-based configurations (SMA/EMA cross, price above SMA, Donchian, Turtle, regime Donchian, Bollinger breakout/reversion, z-score, RSI, Connors RSI2, MACD, time-series momentum, ROC, squeeze, dip in uptrend, session and weekend holds), 5 markets | 0 of 97 pass the final holdout |
| `RESEARCH_NOTE_2026-10-13_FAMILY_SCREEN.md` | family screen | no candidate |
| `RESEARCH_HISTORY_MINING_*` (H2) | history mining | no candidate |
| `RESEARCH_BROAD_UNIVERSE_DISCOVER_RESULT_2026-11-25.md` | broad 56-market discovery | `NO_CANDIDATE` |
| In flight | trade-flow v2 (11/29), S2-S4 (12/05), order-book 3rd (12/10), S5 (12/20), RET48, cross-market momentum, weekly trend (#3308) | waiting |

## 2. Known families not yet tested (the collection)
Cost fit uses the cost wall: spot fee 5 bp a side plus spread. "Data" says whether it exists today.

| # | Family (public name) | Idea | Horizon | Cost fit | Data today | Overlap with running studies |
|---|---|---|---|---|---|---|
| 1 | Cross-sectional short-term reversal | buy last day's biggest losers, sell after 1-3 days | 1-3 d | medium | daily candles | S4 (daily cross-section) |
| 2 | Cross-sectional volume-adjusted momentum | rank by return scaled by volume | 7-28 d | good | candles + volume | weekly trend (#3308) |
| 3 | Low-volatility / betting-against-beta | hold the calmest markets | weekly | good | candles | none |
| 4 | Volume breakout / abnormal volume | enter after a volume spike plus a price break | hours-days | medium | candles + volume | trade-flow v2 (partly) |
| 5 | Pairs / statistical arbitrage | trade a stretched spread of two correlated coins | hours-days | poor (two legs) | candles | none; needs short leg, spot has none: long-only variant only |
| 6 | Maker spread capture | quote both sides, earn the spread | seconds-minutes | depends on queue | order book | S3 (maker 4 h), order-book 3rd |
| 7 | Volatility targeting / risk parity | scale exposure to realised volatility | daily | good (fewer trades) | candles | a sizing layer, not an entry signal |
| 8 | BTC-led lag (alts follow BTC after a move) | buy alts after a BTC jump | minutes-hours | poor | 1m candles | partial: cross-market momentum |
| 9 | New-listing and event drift | buy after a listing notice | days | medium | needs notice feed | none; no feed collected |
| 10 | Foreign-premium (kimchi) spread | KRW price vs global price | hours | needs foreign data and transfer | not collected | none; blocked (HTTP 451 for futures; no foreign feed) |
| 11 | Funding-rate carry / basis | spot vs perpetual | days | good | **blocked** (futures HTTP 451) | none; excluded by the owner |
| 12 | Calendar effects (day of week, month start) | seasonality | daily | good | candles | session/weekend holds already tested (fail) |

## 3. Rules before any of these runs
1. **Candidates may be chosen from the list, but each is judged only on data after 2026-12-05T00:00Z.** All history was read (unseen-data audit in `RESEARCH_THREE_DIRECTIONS_2026-11-25.md` section 0). A backtest on old charts is not a result.
2. **Pre-registration first**, with one decision date, one test, K counted. Every family added raises K and tightens the bar; so add none before the three results of 11/29, 12/05 and 12/10 (`LEARNING_NEXT_CANDIDATES_2026-11-25.md`).
3. **Order-book values stay unread** until 2026-12-10T02:00Z (counts and timestamps only); S2-S4 holdout stays unread until its result prints.
4. No gate is loosened; the owner alone changes limits.

## 4. Suggested order after 12/10 (cost-wall logic, fewest trades first)
3 (low volatility) and 7 (sizing layer) have the lowest cost load; 2 and 1 are cheap extensions of the daily cross-section; 4 and 6 need the order-book results first; 5, 8-12 are blocked or poor on cost and need new data first.

## 5. Not done
No code, no workflow, no run, no registration. Sources are public names of well-known families; no links were verified here.

## 6. Famous investors and traders (owner request 2026-11-25: "collect every famous investor's strategy and test it")
Sorted by whether the method can be written as a price-and-volume rule on spot KRW markets. A method that needs company accounts, a person's judgment or a secret model is **collected but not testable here**.

### 6.1 Rule-writable on candles (testable, forward only)
| # | Source (public name) | Rule in one line | Already covered? |
|---|---|---|---|
| A1 | Richard Dennis / Turtles | 20/55-day Donchian breakout, ATR stop | tested (Turtle 55/20), fail |
| A2 | Ed Seykota | long-term trend following, ATR trailing stop | close to tested (SMA/EMA, Donchian) |
| A3 | Paul Tudor Jones | stay in only above the 200-day average | tested (PRICE_ABOVE_SMA 200), fail |
| A4 | Nicolas Darvas | box breakout on a new high with volume | not tested |
| A5 | Jesse Livermore | pivotal-point breakout after a pause, add on strength | not tested |
| A6 | William O'Neil (price part only) | new high after a base with volume jump | not tested |
| A7 | Mark Minervini (price part only) | trend template (price above 50/150/200, 200 rising, within 25 percent of high), volatility contraction | squeeze partly tested; template not tested |
| A8 | Stan Weinstein | stage analysis on the 30-week average | not tested |
| A9 | Linda Raschke | "Holy Grail" pullback to the 20 EMA in a trend | not tested |
| A10 | Larry Connors | RSI(2) pullback | tested, fail |
| A11 | John Bollinger | band breakout and reversion | tested, fail |
| A12 | Gerald Appel / Wilder | MACD, RSI | tested, fail |
| A13 | Clifford Asness / AQR | cross-sectional momentum, value of price (long-term reversal) | momentum: weekly trend (#3308); 3-5 year reversal: not testable (history too short) |
| A14 | Ray Dalio | risk parity / all-weather volatility weights | sizing layer only (family 7 above) |
| A15 | John Kelly / Ed Thorp | Kelly fraction sizing | sizing layer; touches capital rules, owner only |
| A16 | Cliff Asness / Moskowitz | time-series momentum 12-1 | tested (TSMOM), fail |
| A17 | Mebane Faber | 10-month moving-average timing | close to tested (PRICE_ABOVE_SMA) |
| A18 | Gary Antonacci | dual momentum (relative plus absolute) | partly: DUAL_TREND tested; cross-section plus filter: not tested |
| A19 | Ken French / Fama | size and low-volatility tilts | low-volatility not tested; size needs market cap, not collected |
| A20 | Tom DeMark / Bill Williams / Gann | sequential counts, fractals, angles | rules are vague; collected only |

### 6.2 Collected, not testable here (need data or judgment we do not have or may not use)
Warren Buffett, Benjamin Graham, Peter Lynch, Charlie Munger, Joel Greenblatt (accounts and valuation, no company accounts for coins); George Soros (reflexivity, judgment); Jim Simons / Renaissance, Two Sigma, DE Shaw (secret models, tick and alternative data); Michael Burry, Bill Ackman (single large bets, event judgment); Howard Marks (cycle judgment); Jim Rogers (macro views). Their ideas map to nothing a rule can read from spot candles and order books, and "reading the news" is outside what the system may do (`aiAuthority=ZERO_AUTHORITY`).

## 7. How testing can honestly work
1. **Past charts cannot test them.** Every historical series was read (section 0 of `RESEARCH_THREE_DIRECTIONS_2026-11-25.md`); 97 close-based rules were already screened and none passed. Running more rules on the same history only produces lucky-looking results.
2. **One batch, one decision date, forward only.** The untested rule-writable items (A4, A5, A6, A7, A8, A9, A18, plus families 1-4 and 12 of section 2) can be written once as fixed rules, pre-registered together as one batch with K counted, and run on a hosted runner against data after 2026-12-05. The bar is Bonferroni: per-rule p below 0.05/K, cost stress above zero, down-week clause. No gate or threshold is relaxed.
3. **Cost of waiting is small.** The rules are price-only, so they run in paper without any new collection. A medium-horizon rule (days) needs about 3-6 months to show an edge of a realistic size; this is a statistical limit, not a tooling one.
4. **Order of work:** (a) review this list; (b) write the fixed rules and the batch pre-registration with an independent read-only review; (c) merge it before the registration date; (d) evaluator workflow on a hosted runner. Registration date and decision date are the owner's to confirm.
