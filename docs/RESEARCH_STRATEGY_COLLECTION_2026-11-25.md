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
