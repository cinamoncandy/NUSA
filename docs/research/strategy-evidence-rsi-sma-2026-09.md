# Strategy evidence: SMA vs RSI walk-forward on real Upbit data (2026-09-05)

Status: **evidence only — no registration, promotion, or production change.**
Verdict summary: **no qualified candidate** (details below).

## Method (reproducible)

- Data: real Upbit `KRW-BTC` 1-minute candles, 30,400 points,
  `2026-08-15T03:03Z` → `2026-09-05T05:53Z`, fetched from the public
  `GET /v1/candles/minutes/1` endpoint (200/req pagination, no key).
- Engine: existing `runWalkForward` (no modifications) with
  `trainSize: 10080` (7d), `testSize: 2880` (2d), non-overlapping steps,
  anchored=false → **7 complete windows**, 20,160 OOS points.
- Costs (explicit, conservative): `feeRate: 0.0005` (Upbit taker),
  `spreadBps: 2`, `slippageBps: 5`, `orderQuantity: 0.001`,
  `initialCash: 10,000,000`.
- Candidates (existing implementations only, no new strategy):
  `sma-5-20`, `sma-10-30`, `rsi-14-30-70`.
- Selection policy: `{ minimumClosedTrades: 3, maximumDrawdown: 0.5 }`.
- Code revision recorded in the evidence JSON held with this report's
  author; dataset refetch command:
  `node fetch-candles.js KRW-BTC 21 candles.json` (script kept outside
  the repo; endpoint + pagination documented above).

## Results (out-of-sample, cost-aware)

| Family | Windows selected | OOS profitable windows | Combined OOS return (14d) | Max DD |
|---|---|---|---|---|
| rsi-14-30-70 | 7/7 | 4/7 | **+0.21%** | 0.73% |
| sma-5-20 | 0/7 | — (never selected, even in-sample) | — | — |
| sma-10-30 | 0/7 | — (never selected, even in-sample) | — | — |

- 264 closed OOS trades, win rate 49.2%, profit factor 1.10.
- Total trading costs **70,365 KRW** (fees 31,985 + spread 6,397 +
  slippage 31,983) against **9,016 KRW** net profit — costs consume
  ~89% of gross edge.
- Engine warnings (kept, not suppressed):
  `TRAIN_OOS_PERFORMANCE_DIVERGENCE`,
  `OOS_RESULTS_CONCENTRATED_IN_FEW_WINDOWS`, `CANDIDATE_SELECTION_DOMINANCE`.
- Train-vs-OOS gap: average train score 17.82 vs average OOS return
  0.0003 per window — textbook overfit signature.

## Verdicts (research/PAPER eligibility only, never execution authority)

- `rsi-14-30-70`: **INSUFFICIENT** — survives costs but the edge
  (+0.21%/14d ≈ +5.5%/yr naive annualization) is within noise given
  4/7 profitable windows, dominance warning, and live-slippage reality.
  Not a promotion candidate.
- `sma-5-20`, `sma-10-30`: **REJECTED** — fail to qualify even
  in-sample under modeled costs on this dataset/period.
- No registry, League, PAPER, or production changes result from this run.

## What would change the verdict

Longer OOS span (multiple regimes), fee-tier-accurate costs, latency
modeling, and an independent second dataset — the last one is now done,
see below. The rest remain unclaimed.

## Second market: KRW-ETH (same method, 2026-08-15 → 2026-09-05)

- 30,400 real 1m candles, same 7-window walk-forward, same costs and
  selection policy (`orderQuantity: 0.01` for ETH scale).
- Selection: `rsi-14-30-70` 6/7 windows, `sma-10-30` 1/7, `sma-5-20` 0/7.
- Combined OOS over 229 closed trades: **-0.04% total return
  (-9,065 KRW net)**, win rate 41.9%, profit factor 0.73, max DD 0.21%.
- Costs 18,711 KRW (fees 8,505 + spread 1,701 + slippage 8,505) exceed
  gross edge outright. Additional warning vs BTC run:
  `COSTS_DOMINATE_OOS_PERFORMANCE`.

## Updated verdicts

- `rsi-14-30-70`: **REJECTED** (was INSUFFICIENT on BTC alone) — negative
  cross-market OOS with costs dominating in both datasets.
- `sma-5-20`, `sma-10-30`: **REJECTED** (unchanged).
- Cross-market confirmation strengthens the kill: no family here shows a
  durable edge. Still no registration, promotion, or production change.
