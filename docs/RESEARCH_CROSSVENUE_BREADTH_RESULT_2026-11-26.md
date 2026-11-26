# Result: the breadth filter, one run on Binance daily history (2026-11-26)

Korean summary (한 줄): 해외 거래소 14종목, 2018-01-01~2026-11-25 한 번의 실행에서 규칙은 **사전등록 기준으로 FAIL**이다. 두 약세장 모두 낙폭은 크게 줄였지만 2022 구간(0.703배 대 기준 0.7배)과 무작위 비교(9,178/10,000 대 9,500)가 기준에 못 미쳤다. 숫자는 바꾸지 않았고 다시 돌리지 않았다.

Pre-registration: `docs/RESEARCH_PREREG_2026-11-26_CROSSVENUE_BREADTH.md` (PR #3322, merged 2026-11-26T02:00:06Z = 11:00 KST). One run, no re-run, no tuning.

## 1. What was run
- Fetch 2026-11-26T02:17:05Z (11:17 KST) from `data-api.binance.vision`; 517 USDT spot symbols listed, 14 kept by the registered rule (first daily candle on or before 2019-01-01, at least 1,500 candles, last candle 2026-11-25): ADA, BNB, BTC, ETC, ETH, IOTA, LTC, NEO, ONT, QTUM, TRX, VET, XLM, XRP (all vs USDT). manifest.json sha256 `b88d42beca2936e8fbb307e51543825c93f9049b1b129d8f08cc13d862b0443e`.
- Script at the merged commit, with **one deviation**: the first fetch attempt crashed on a symbol with non-ASCII characters ("Request path contains unescaped characters") after 14 files. The only change is `encodeURIComponent(sym)` in the two kline URLs (merged script sha256 `5f8d3c4dd5a20a8485e29dfe7692cabce0fd17dab7e8a4bb919e841fb3262f9c`, run script `4d563d48ad1419e05b13ab4e633a202fc72f3de9a421495c3ff1af08f2ea3ef6`). It affects URL encoding only, no number or rule; the fix is committed with this note. The partial first fetch was discarded before any analysis, and no analysis ran before the final data were complete.
- One evaluation of the 14 files; output sha256 `aace07abba7558c973e589502934e9972876f5115a194fa965c5a06b1a95ce1e`.

## 2. Result (verbatim output)
```
CROSSVENUE_BREADTH {
 "signalDays": 3250,
 "eligibleDays": 3011,
 "informative": true,
 "full": {
  "filteredMDD": 0.6202243885532882,
  "benchMDD": 0.8334088993698227,
  "filteredNet": 11.620768005158956,
  "benchNet": 1.445840508707136,
  "stressF": 8.287353175336241,
  "stressB": 1.4421662365358316,
  "activity": 0.44038525406841583,
  "switches": 204,
  "placeboWins": 9178,
  "placeboDrawn": 10000,
  "conditions": {
   "1": false,
   "2": true,
   "3": true,
   "4": true,
   "5": false,
   "6": true,
   "7": true
  }
 },
 "bear": {
  "2018": {
   "eligibleDays": 126,
   "minEligibleMarkets": 10,
   "maxEligibleMarkets": 14,
   "filteredMDD": 0.270264355493564,
   "benchMDD": 0.65051178133734,
   "ok": true,
   "benchInformative": true
  },
  "2021-11..2022": {
   "eligibleDays": 426,
   "minEligibleMarkets": 14,
   "maxEligibleMarkets": 14,
   "filteredMDD": 0.5582594407561939,
   "benchMDD": 0.794135100281693,
   "ok": false,
   "benchInformative": true
  }
 },
 "defensiveOnly": false,
 "verdict": "FAIL"
}
```

Reading of the numbers (full span, 3,011 eligible of 3,250 signal days):
- Maximum drawdown: filter 62.0 percent versus benchmark 83.3 percent (ratio 0.744; condition 1 needs at most 0.7: not met).
- Net return: filter +1,162 percent versus benchmark +145 percent; stress (30 bp) +829 percent versus +144 percent. The filter did not give up return, it exceeded it.
- Placebo: the filter's drawdown was strictly smaller than the placebo's in 9,178 of 10,000 schedules (needs 9,500: not met; 91.8 percent).
- Activity 44 percent, 204 switches (inside the 20 to 90 percent band).
- Bear window W1 2018: filter 27.0 versus benchmark 65.1 percent (ratio 0.42, met). Bear window W2 2021-11..2022: filter 55.8 versus 79.4 percent (ratio 0.703, **missed the 0.7 bar by 0.003**).
- Conditions 2, 3, 4, 6 and 7 were met; 1 and 5 and the W2 bear-window condition were not. Verdict: **FAIL**.

## 3. Honest reading
- By the registered rule this is a FAIL and is reported as one; the near-miss on W2 does not change that, and no threshold may be moved afterwards.
- The direction is encouraging and consistent with the history screen on Upbit: in both bear phases the filter's drawdown was clearly smaller than the benchmark's (about 58 and 30 percent smaller in the two windows by drawdown ratio 0.42 and 0.70). The pass bars (0.7 ratio over the full span, 95 percent placebo) were demanding, and a loss of 0.003 is within noise.
- The result carries large caveats, all stated in advance: only 14 symbols qualified, all of them survivors that are still trading in 2026, so both the benchmark and the filter are flattered by survivorship and the basket is thin (10 to 14 markets in 2018); the return gap (+1,162 versus +145 percent) is partly a survivorship and rebalancing effect and must not be read as an edge; two bear windows are not many independent cycles; Binance is not Upbit and fees and spread are not tested.
- It does not change the forward Upbit study (L30/L60/L90/L183): that continues unchanged. It does not support any PAPER shadow decision on its own.

## 4. Not done
No threshold, universe or window was changed; no second run; no live authority, risk limit or capital change. PAPER_ONLY, liveAuthority=NONE, productionMutationAllowed=false, aiAuthority=ZERO_AUTHORITY.
