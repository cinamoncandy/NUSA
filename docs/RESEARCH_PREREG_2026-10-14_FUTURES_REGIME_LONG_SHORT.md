# Pre-registration: regime-aware long/short on Binance USD-M perpetuals (PAPER research)

Status: **PRE-REGISTERED, 2026-10-14**, before any futures history was downloaded or inspected. Nothing in this
document may change after the data is frozen; any change starts a new pre-registration with a new date.
Work order: `WO-FUTURES-20261014-RESEARCH-PREREG`. Design: `docs/NUSA_CLAUDE_DESIGN_V1.md` §3 (B4).

Scope: PAPER research only. No API key, no account, no order, no runtime wiring. A PASS makes the rule eligible for a
formal Research experiment and a futures shadow run; it is **not** promotion evidence and changes no limit.

## 1. Why
Spot research found that the best surviving idea (REGIME_BREAKOUT N=50) earns in rising windows and loses in falling
ones (`docs/RESEARCH_NOTE_2026-10-13_BREAKOUT_WALKFORWARD.md`). Spot can only sit out a fall. Perpetual futures can
short. The question is whether the short side earns in down regimes **after fees, slippage and real funding**.

## 2. Hypothesis (one rule, fixed now)
- **Bars:** 4-hour, Binance USD-M public klines.
- **Regime:** close above its 200-bar simple moving average = UP; below = DOWN.
- **Entry:** UP and close above the highest high of the previous 50 bars → LONG. DOWN and close below the lowest low of
  the previous 50 bars → SHORT. Orders fill at the next bar's open.
- **Exit:** a LONG exits when close falls below the lowest low of the previous 25 bars or the regime turns DOWN; a SHORT
  mirrors this. One position per symbol, no pyramiding, no flip in one bar.
- **Sizing and risk (the owner's futures limits, `PAPER_FUTURES_OWNER_LIMITS`):** leverage 2x, isolated margin, margin
  per position 20% of start-of-day equity, new entries blocked after 3 consecutive losing closes in a KST day or a 5%
  daily realized loss, liquidation-distance floor 25%.
- **Simulator:** `apps/cloud/src/futures/paperFuturesSimulator.ts` and `paperFuturesRiskGate.ts` as merged in #2703,
  unchanged.

## 3. Costs
- Taker fee 0.05% per side; adverse slippage 5 bps per fill; maintenance margin rate 0.4%.
- Funding: the real historical 8-hour funding rate for each symbol, applied at each funding time while a position is open.
- Stress run: fee and slippage doubled (funding unchanged).

## 4. Data (to be frozen before evaluation)
- **Symbols:** BTCUSDT, ETHUSDT, SOLUSDT, XRPUSDT, DOGEUSDT (the same five markets as the spot research).
- **Range:** 2023-01-01T00:00Z to 2026-10-14T00:00Z, 4h klines and funding history from public endpoints only,
  fetched from the PAPER host (B0 showed it is reachable).
- **Freeze:** the raw files and their SHA-256 hashes are committed before any evaluation code reads them. The evaluation
  refuses to run on files whose hashes differ.
- **Warm-up:** the first 200 bars per symbol only build the moving average.

## 5. Splits
- **Development:** 2023-01-01 to 2025-10-14 — used only to check that the code runs and produces trades; its result is
  reported but cannot pass or fail the hypothesis.
- **Holdout:** 2025-10-15 to 2026-10-14 (the last 365 days) — untouched until the code and this document are frozen;
  evaluated exactly once.
- **Regime windows inside the holdout:** each calendar month is labelled UP or DOWN by BTCUSDT's month-end close versus
  its 200-bar average, decided by the rule above, not by eye.

## 6. Pass rule (all must hold on the holdout)
1. Mean net return per round trip > 0 at base costs **and** at doubled costs.
2. At least 30 round trips across all symbols.
3. At least 3 of 5 symbols with positive net P&L at base costs.
4. Net P&L of SHORT trades during DOWN months > 0 (the reason this study exists).
5. Maximum drawdown of the combined PAPER futures equity ≤ 20%.
6. No liquidation.

Anything else is FAIL. A FAIL is recorded as such; no parameter is tuned on the holdout afterwards.

## 7. Sensitivity (reported, never used to choose)
The same run with breakout N = 20 and N = 100 (exit N/2) is reported beside N = 50. Only N = 50 can pass. If N = 50
fails and another N passes, that is a new hypothesis for a new pre-registration on new data.

## 8. What happens next
- PASS: open a formal Research experiment and a futures shadow run on live public data (still PAPER, still no keys).
- FAIL: record it in a research note, keep futures in research only, and report to the owner.
- Either way the owner decides any next step that changes strategy, limits or capital.

## Addendum 2026-10-19 (data handling only; made before any futures history was downloaded)
Owner decision 2026-10-19: instead of committing the raw files, the SHA-256 manifest of the fetched files is committed, and the
evaluation re-fetches the same public history and refuses to run unless every file hash matches the committed manifest
(`scripts/fetch-futures-history.js`, `verify()`). Closed historical bars are immutable, so the integrity guarantee is unchanged.
No hypothesis, symbol, range, split, cost, risk limit or pass rule in §1-§8 changes.

## Result 2026-10-20 (holdout evaluated once)
Run `futures-regime-study` 39352194710 on release fd278dc35, after the history was re-fetched and matched the committed manifest.
Full report: `research/futures/futures-regime-holdout-result.json`.

**Verdict: FAIL.** Holdout, N = 50, failed §6 conditions 1, 3, 4 and 5:

| Holdout N = 50 | Base costs | Doubled costs |
| --- | --- | --- |
| Round trips | 112 | 112 |
| Mean net return per trip | -0.22% | -0.41% |
| Profitable symbols | 0 / 5 | 0 / 5 |
| SHORT P&L in DOWN months | -899 USDT | -1,282 USDT |
| Max drawdown | 53.9% | 56.2% |
| Liquidations | 0 | 0 |

Per §6–§8: the result is recorded as FAIL, no parameter is tuned on this holdout, and futures stay research-only. The sensitivity
runs (N = 20 / 100) are reported in the file and cannot pass the study. N = 100 also failed (drawdown 39.6%). Any idea drawn
from them is a new hypothesis that needs a new pre-registration on new data. The owner decides any next step.
