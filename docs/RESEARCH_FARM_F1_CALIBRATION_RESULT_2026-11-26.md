# Farm F1 calibration and power check: result note v2 (2026-11-26, RESULT, second review applied)

Korean summary (한 줄): 고친 절차(v2)의 **가짜 통과율 상한은 약 0.6퍼센트로 목표 1.25퍼센트 이하**였다. **검출력은 낮다**: 규칙 하나의 표본 안에서 심은 샤프가 2면 약 1퍼센트, 4면 약 27퍼센트, 6이면 약 77퍼센트가 180일에 통과한다. 합성 가격 경로만 썼으므로 "교정 통과"가 아니라 **합성 경로에서의 상한 확인**이다.

Status: **RESULT of an offline script.** PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`. Script: `scripts/offline-farm-f1-calibration.js` (no network, no market data, no host change). Design: `docs/ALPHA_LAB_2_SMALL_FARM_AND_TRACK_R_DESIGN_2026-11-26.md` section 5.

**History (disclosed):** a v1 run (8,000 repetitions) was **withdrawn**. An independent review found the bootstrap critical value (median 4.57) far above the true null 98.75 percent quantile (about 2.9): the bootstrap did not re-apply the benchmark adjustment per draw, and the t denominator ignored the exposure factor. v1 numbers (pass 0.00025, Sharpe 6 pass 61 percent) are void. v2 fixes the bootstrap (benchmark re-applied per draw, fixed observed scale, degenerate flat resamples scored 0) and is the only result here. One intermediate v2 variant (per-draw studentization) blew up on sparse resamples (critical value near 8) and was replaced before any full run; that variant is not kept in the repository, so this cannot be independently verified.

## Setup (as run)
Command: `node scripts/offline-farm-f1-calibration.js 4000 300` (4,000 repetitions, 300 bootstrap draws, seed 20261126); script sha256 prefix `bb79dcabe03d7498` at run time (a later commit changed only a degenerate-sd guard from `< 1e-9` to `<= 1.5e-9`; it does not affect these runs). Synthetic GARCH(1,1)-t4 paths (parametric, not block-bootstrapped history: a departure from design section 5), 180 days, daily vol 3.5 percent; 48 random exposure-matched long/flat schedules (at most 24 round trips a year), 15 bp per side, 365-day annualization; statistic: max t of benchmark-adjusted net excess; stationary bootstrap (block 5), cohort alpha 0.0125; one control family of 48 random schedules as a downgrade-only gate; power scenarios inject an edge into **one** of 48 rules, sized to that rule's own daily volatility (label = annualized Sharpe of the added drift). Bounds are Wilson upper limits at 95 percent (two-sided interval used as a 97.5 percent one-sided bound).

## Result
| Scenario | Cohort pass | Wilson upper (97.5% one-sided) | Control exceeds bar | Pass after gate | Mean critical value |
|---|---|---|---|---|---|
| null, drift 0 | 0.00375 | 0.0062 | 0.0045 | 0.00375 | 3.08 |
| null, market drift +0.15 percent a day | 0.0035 | 0.0059 | 0.00525 | 0.0035 | 3.05 |
| edge, Sharpe 2 | 0.011 | 0.014 | 0.00375 | 0.011 | 3.11 |
| edge, Sharpe 4 | 0.273 | 0.287 | 0.00375 | 0.272 | 3.15 |
| edge, Sharpe 6 | 0.774 | 0.787 | 0.0035 | 0.771 | 3.22 |

## What this shows and does not show
- The false-pass **upper bound (0.62 percent) is below the 1.25 percent target**, with positive market drift too (beta is removed). It is still about three times below nominal, so the procedure is somewhat conservative not exactly calibrated. Reviewer diagnostic (no bootstrap, 4,000 fresh null paths): the true 98.75 percent quantile of max t is **2.79 with cost and 2.91 with zero cost**, below the mean critical value used (3.08), so the true exceedance at that value is about 0.6 percent (0.75 percent at zero cost). Cost drag explains only part of the gap; the rest is a **studentization mismatch**: the bootstrap divides by a fixed observed sd while the observed statistic is normalized per path, and under heavy tails that puts the bootstrap quantile above the true one.
- **Bootstrap size caveat:** the critical value depends on the number of draws (3.08 at 300 draws, about 3.14 to 3.15 at 1,000 in the reviewer's check), so these pass rates and the power figures belong to the 300-draw run, not to a converged procedure; **power at Sharpe 4 and 6 is probably mildly overstated**. A 1,000-draw re-run was not done (about an hour and a half).
- The **control family** exceeds the bar about as often as the cohort does under the null (0.45 percent), as it should: the gate's false-alarm rate is of the same order as alpha. It rarely downgrades a real pass here.
- **Power at 180 days is low**: about 27 percent at Sharpe 4 and 77 percent at Sharpe 6 (one rule in 48). This agrees with the design's bar near Sharpe 5 or more.
- **Not done:** historical-path secondary check (history up to 2026-11-04 only), real block-bootstrapped paths, Romano-Wolf step-down, confirmation-step logic, parameter uncertainty or regimes. Synthetic results bound, and do not prove, the forward false-pass rate.

## Recommendation (AI proposal; the owner may amend)
The go/no-go now has numbers: a farm cohort detects only an effect near Sharpe 5 or more, and almost never one at Sharpe 2 to 3. Realistic spot-market edges after fees are likely well below that. So: **no real cohort now**; keep Track R and the data asset as the priority; reopen Track F only if a longer window (more days per look) or a larger effect size is justified. A second independent review of v2 is required before this note is relied on.
