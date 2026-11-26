# Farm F1 calibration and power check: result note (2026-11-26, RESULT, review pending)

Korean summary (한 줄): 합성 가격 경로에서 농장 절차의 **가짜 통과율은 매우 낮았고(상한 약 0.1 퍼센트)**, **검출력도 낮았다**(샤프 2에서 약 8 퍼센트, 4에서 약 44 퍼센트, 6에서 약 61 퍼센트). 절차가 **너무 보수적**일 가능성이 있어 원인 검토 전에는 "교정 통과"라고 부르지 않는다.

Status: **RESULT of an offline script, independent review pending.** PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`. Script: `scripts/offline-farm-f1-calibration.js` (no network, no market data, no host change). Design: `docs/ALPHA_LAB_2_SMALL_FARM_AND_TRACK_R_DESIGN_2026-11-26.md` section 5.

## Setup (as run)
Synthetic GARCH(1,1)-t4 paths, 180 days, daily vol 3.5 percent, fresh path per repetition; 48 random exposure-matched long/flat schedules (at most 24 round trips a year), 15 bp per side; statistic: max t of benchmark-adjusted net excess (position times return minus switch cost minus mean position times mean market return); stationary bootstrap (block 5, 500 draws, centered), cohort alpha 0.0125; one control family of 48 more random schedules as a downgrade-only gate; 8,000 repetitions per scenario, seed 20261126. Power scenarios inject a synthetic edge into **one** of the 48 rules.

## Result (8,000 repetitions each)
| Scenario | Cohort pass rate | 95% upper bound | Control exceeds bar | Pass after gate |
|---|---|---|---|---|
| null, drift 0 (cost 15 bp) | 0.00025 | 0.00091 | 0.000125 | 0.00025 |
| null, market drift +0.15 percent a day | 0 | 0.00048 | 0 | 0 |
| null, drift 0, **zero cost** (boundary check) | 0.00025 | 0.00091 | 0.00025 | 0.00025 |
| injected edge, Sharpe 2 | 0.079 | 0.085 | 0 | 0.079 |
| injected edge, Sharpe 4 | 0.442 | 0.452 | 0 | 0.442 |
| injected edge, Sharpe 6 | 0.607 | 0.618 | 0 | 0.607 |

## What this does and does not show
- The false-pass **upper bound is far below the 0.0125 target** in every null scenario, including positive market drift (the benchmark adjustment removes beta) and zero cost.
- A rate 50 times below the target means the procedure is **over-conservative or the statistic is mismatched** (a likely cause: rules share one market path, and the bootstrap critical value may exceed the true null spread). It is **not** an exact calibration, and the cause is **not yet diagnosed**.
- **Power is low**: a rule with a true Sharpe of 4 passes under half the time over 180 days; a Sharpe of 6 passes about 61 percent. This agrees with the design's expectation (bar near Sharpe 5 or more). The injection is approximate (a daily drift added on in-position days), so the Sharpe labels are approximate.
- Synthetic paths only. The historical-path secondary check (history up to 2026-11-04) and the confirmation-step logic were **not** run. Bounds, not proof, for the forward false-pass rate.

## Recommendation (AI proposal; the owner may amend)
Do **not** register a real cohort. First (a) diagnose the over-conservatism (compare the bootstrap critical value with the empirical 98.75 percent quantile of max t under the null) and (b) re-run. The go/no-go in the design (detectable Sharpe near 5 or more) now has numbers behind it: by this run, a farm cohort is **very unlikely to detect anything realistic**, so my recommendation is that Track F stays at F1 and effort goes to Track R and the data asset unless the diagnosis changes this.
