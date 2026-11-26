# PREREG desk-b: 6 seasonality rules (K=6), written before any script was run
Data: scalp-data/<MARKET>.json, KRW-BTC/ETH/XRP/SOL/DOGE, 5-min bars [tsMs,o,h,l,c,v], UTC, 2025-11-05..2026-11-04.
Bar t is labelled by its open time. Entry = close of the stated first bar; exit = close of the stated last bar (the bar opening 5 min before the window end), so the hold is the window minus one bar. Long only, one position per market, a trade is dropped if the bars between entry and exit are not contiguous (timestamp gap) or data ends.
Rules (hold in bars):
1 HOUR_00_03: entry bar opens 00:00 UTC, exit bar opens 02:55. H=35.
2 HOUR_08_11: entry bar 08:00, exit bar 10:55. H=35.
3 HOUR_13_16: entry bar 13:00, exit bar 15:55. H=35.
4 KST_OPEN_REV: entry bar 00:00, exit bar 00:55 (H=11), only if close of the bar opening 23:55 (the previous bar) / close of the bar 4h (48 bars) before it - 1 < -1%. (Uses only data up to 00:00 UTC.)
5 SUN_NIGHT: entry bar Sunday 20:00 UTC, exit bar Monday 01:55 (H=71).
6 FIRST_BAR_BREAK: entry bar 00:00; signal if close(00:00 bar) > close(previous 23:55 bar) * 1.005; exit bar opens 05:55 (H=71).
Costs: 10 bp a side base, 15 bp stress; net = gross - 2*fee - 2*fee*gross (as in reference).
Parts: bars=min length; part 2 = last 90*288 bars; part 1 = first (bars-part2) bars cut into 6 equal windows (floor); a trade is in part 1 if its exit index < cut and in part 2 if its entry index >= cut; straddlers dropped; window by entry index; window market return = mean over markets of close(end)/close(start)-1.
Part-1 pass: >=300 trades; every window has >=1 trade; mean net > 0 in >=4 of 6 windows; mean of up-window means > 0 and of down-window means > 0 (both groups non-empty); stress mean > 0 in >=4 of 6.
Part-2 pass: >=100 trades, mean net > 0, one-sided z p < 0.05/6, stress mean > 0. No rule, bar or threshold may change after results.
