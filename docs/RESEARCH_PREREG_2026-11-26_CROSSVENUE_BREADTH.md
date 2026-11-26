# Pre-registration: the breadth filter, one run on another venue's history (2026-11-26)

Korean summary (한 줄): 업비트 56종목에서 고른 "절반 이상이 50일선 위일 때만 보유" 규칙을, 숫자 하나 바꾸지 않고 해외 거래소(Binance 현물, USDT) 일봉 2018-01-01~2026-11-25에 딱 한 번 적용한다. 약세장 두 번(2018, 2021-11~2022)에서 손실폭이 줄었는지 본다. 앞으로 쌓이는 업비트 검증을 대신하지 않는다.

Owner decision 2026-11-26: the forward wait is too long; asked for an alternative; chose this one ("해"). Registers on merge; the run happens only after merge.

## 1. Question
Does the same frozen rule (`docs/RESEARCH_PREREG_BREADTH_FILTER_2026-11-25.md` section 2, unchanged) cut the maximum drawdown clearly, while keeping a reasonable part of the return, on a different venue's daily history with several bear phases?

## 2. Universe (mechanical, fixed by this rule, no look at prices)
Public endpoint `data-api.binance.vision`, `exchangeInfo`: status TRADING, spot, quote USDT; exclude base assets in the stable/wrapped list in `scripts/offline-crossvenue-breadth.js` (`STABLE_BASES`) and bases ending in UP/DOWN/BULL/BEAR; keep a symbol only if its first daily candle is on or before 2019-01-01 and it has at least 1,500 daily candles to 2026-11-25. The kept list and the sha256 of every data file go into a manifest before any evaluation.

## 3. The rule and the run
- The rule, eligibility (90 candles, 50 consecutive closes, at least 10 eligible markets), signal timing, equal-weight daily rebalance, costs (15 bp per unit of position change; stress 30 bp), benchmark and missing-candle treatment are exactly those of the original. Cash earns 0.
- **Signal days 2018-01-01 to 2026-11-24** (held days 2018-01-02 to 2026-11-25). Days with fewer than 10 eligible markets are cash for both the filter and the benchmark and are excluded from the evaluation.
- One evaluation by `node scripts/offline-crossvenue-breadth.js run <dir>` at the merged script commit, on the fetched files; no re-run to change an outcome. A fetch failure is retried unchanged.

## 4. Pass conditions (all must hold)
1 to 7 of the original, on the full span, with the placebo drawn from mulberry32 seed 20261126 (10,000 schedules; exactly H invested days and S switches of the filter, on the eligible days, first state as the filter's; at least 9,500 must have a strictly larger maximum drawdown than the filter). Condition 6 (activity 20 to 90 percent) and 7 (defensive-only) as in the original.
8. **Bear windows:** in each of W1 = 2018-01-01..2018-12-31 and W2 = 2021-11-01..2022-12-31 the benchmark's maximum drawdown is at least 20 percent and the filtered maximum drawdown is at most 0.7 times the benchmark's (equity restarted at the window start).
`NOT_INFORMATIVE`: fewer than 80 percent of the signal days have at least 10 eligible markets. Otherwise `PASS` or `FAIL`.

## 5. What a result means
- `PASS`: a strong hint that the rule cuts drawdown across several bear phases on a second venue. It is **not** a pass of the Upbit forward study, not evidence of an edge after Upbit fees, and gives no authority. It may let the owner consider a PAPER-only shadow run earlier than the forward study ends; the forward study (staged looks, `docs/RESEARCH_PREREG_AMENDMENT_2026-11-26_BREADTH_STAGED_LOOKS.md`) continues and its L183 remains the bar for anything beyond PAPER shadow.
- `FAIL`: reported as negative cross-venue evidence; the forward study continues unchanged unless the owner decides otherwise.

## 6. Disclosures (read before the result)
- **Contamination:** the author already knows in general terms that 2018 and 2022 were bear markets and that crowds of coins fell together, so this is not unseen data in the strict sense. The rule was fixed before this run and nothing is tuned, but a pass is weaker than a forward pass.
- **Survivorship:** `exchangeInfo` lists only symbols trading now; coins that were delisted or collapsed are absent, which flatters both the benchmark and the filter (the effect on the ratio is unknown). Only symbols listed by 2019-01-01 enter; in 2018 the basket is small (a few dozen at most).
- **Venue differences:** Binance fees and spreads differ from Upbit's; USDT quotes are not KRW; the Upbit cost wall (fee plus spread) is not tested here; costs use the same 15 bp for comparability.
- Market-wide co-movement means the markets are far from independent; conditions 1 to 4 are not significance tests, the placebo is the only inferential condition. K is not controlled across studies. One decision under conditions 1 to 8.
- The fetch is of public daily candles only; no PAPER host, key or setting is involved.

## 7. Not done
No data was fetched or analysed for this document; the script was tested on synthetic random walks only (it returned FAIL, as it should on noise). Gates, thresholds, risk limits, capital and authority are unchanged.
