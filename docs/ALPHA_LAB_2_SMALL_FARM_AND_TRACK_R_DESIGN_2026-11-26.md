# Alpha Lab 2: Track R first, a small forward test farm second (DESIGN PROPOSAL, 2026-11-26)

Korean summary (한 줄): 사장님이 "작은 농장 + 트랙 R 우선"으로 설계하라고 했다(2026-11-26). 이 문서는 **제안**이며 코드, 실행, 서버 변경이 없다. 농장은 **작게(한 묶음 최대 48개 규칙)** 시작하고, 먼저 **가짜 통과율의 상한을 어림하는 교정(F1)**을 통과해야만 진짜 규칙을 넣는다. 못 찾으면 "못 찾았다"로 기록한다(없다는 뜻은 아니다).

Status: **PROPOSAL, docs only, needs a non-author review before any build.** PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `realOrderAuthority=false`, `aiAuthority=ZERO_AUTHORITY`, FAIL_CLOSED. Server-code PRs stay frozen until 2026-11-28 15:00 KST; no host release before the owner says so. Builds on `docs/ALPHA_LAB_COMPLETION_ROADMAP_2026-11-26.md` (A1 to A8, G1 to G5). Nothing here loosens a gate, bar or threshold.

## 1. Why a farm at all, and why small
The bottleneck is independent evidence per calendar day. A farm tests a **fixed, hashed cohort** of rules on public candles, so one wait tests many rules together. It adds **no statistical power**: more rules means a stricter family-wise bar. It is a way to use time and to estimate a bound on our false-pass rate, not a source of edge. The farm **records daily signals and fetched candles with manifests and computes no performance statistic before a registered look** (blind principle of the breadth and weekly-trend amendments).

## 2. Power check (recomputed by the independent review; annualization 365)
The standard error of annualized Sharpe is about 1/sqrt(T): 2.0 at 90 days, 1.4 at 180, 1.0 at 365 (strictly slightly larger). Bonferroni over 48 rules at alpha 0.05 uses z = 3.08. With the programme alpha split over 4 cohorts a year (0.0125 each, z about 3.47) the 180-day bar is a **true Sharpe near 4.9 at 50 percent power and near 6.1 at 80 percent power**; at alpha 0.05 it is 4.4 (50 percent) and 5.5 (80 percent). Bonferroni is conservative for correlated rules; the true effective K is unknown. Costs subtract about 0.45 Sharpe per 100 round trips a year (15 bp per side, 3.5 percent daily volatility), so a rule needs a true gross Sharpe of the bar plus that drag; **proposal: at most 24 round trips a year per rule**.
Consequences, stated first: only a **very large** effect can pass at 180 days; "nothing passes" is the expected outcome. **Go/no-go:** Track F is built beyond F1 only if the owner accepts that its detectable effect is a Sharpe near 5 or more. If not, Track F ends at F1 and Track R continues.

## 3. Track R first (already registered, no new test)
Track R is the defensive breadth overlay. Its evidence path is frozen in `docs/RESEARCH_PREREG_AMENDMENT_2026-11-26_BREADTH_STAGED_LOOKS.md`: L30 2027-01-05 and L60 02-04 (reject-only: FAIL_EARLY or continue), L90 03-07 (provisional), L183 06-07, all 03:00Z; an L90 pass stands only if L183 passes, and L183 also decides the case where L90 was NOT_INFORMATIVE. Track R's goal is lower drawdown, not excess return. This design adds **no bar** for Track R; it adds only the hosted-runner fetch and evaluate workflows (roadmap A3). Its **monthly status line states only look dates, fetched-day counts and manifest status; no return, drawdown or exposure number is computed or shown before a look.** Cross-venue evidence was a FAIL with near misses (`docs/RESEARCH_CROSSVENUE_BREADTH_RESULT_2026-11-26.md`), so every report carries survivor and near-miss caveats.

## 4. The small farm (Track F)
- **Names**: farm looks are **F180** and the confirmation step below; they are not Track R's L90/L183.
- **Cohort**: at most **48 rules**, frozen with a hash and K = 48 (plus any parent screen K) before the first evaluated day; at most **4 cohorts a year**. Rules are proposed under ZERO_AUTHORITY; the hash is approved by the owner or a non-author reviewer. Near-duplicates of the breadth or weekly-trend rules are excluded so the registered studies are not double-spent.
- **Rule form**: low turnover (cap above), daily public candles, long or flat spot, a grammar declared before the run.
- **Blind windows**: the first evaluated day is after 2026-12-05; any lookback reaching into 2026-11-05..12-05 is a holdout read and forbidden; order-book rules cannot be evaluated before 2026-12-10.
- **Null hypothesis**: no timing skill, meaning the net return is no better than an **exposure-matched random schedule** on the same path. Raw positive drift is not evidence. It conditions on the realized path; it does not control path-level luck, which only F1 and the forward replication address.
- **Test**: one stationary-bootstrap max statistic across the 48 rules on net-of-cost daily returns against that null (Romano-Wolf step-down style), cohort alpha 0.0125. **No alpha is spent before F180; there is no earlier accept path.** The block length and exact statistic are fixed in the cohort pre-registration (open until then).
- **Control family (outside the 48)**: each cohort also computes one matched random-schedule control family with frozen seeds (mulberry32) and the same statistic. If the control family's max statistic exceeds the cohort bar, the cohort is NOT_INFORMATIVE. The gate can only **downgrade** a result, never upgrade one; its false-alarm rate is estimated in F1.
- **PASS meaning**: a rule clearing F180 becomes a **shadow candidate** (PAPER-only tracking, no authority) and then needs **one single-rule confirmation** (K = 1, alpha 0.05) on the **next 180 days of data not yet seen at the time of the F180 look**, registered before that data. Only that confirmation can feed candidate states. No order path, no order ids.

## 5. Calibration F1 (bounds, does not prove)
F1 estimates the procedure's false-pass rate on randomized schedules over **block-bootstrapped synthetic price paths (main)** and over one fixed historical path (secondary). History is read only up to **2026-11-04**, with no holdout and no order-book values.
- Calibrate the **whole procedure** (F180, control gate, confirmation logic), with thousands of repetitions; require the **Monte Carlo upper confidence bound** of the false-pass rate to be at or below the cohort alpha 0.0125.
- **Power check:** inject a synthetic edge (Sharpe 2, 4, 6) and report the pass rate, so a method that never passes is not called calibrated.
- Historical-path results carry drift, survivorship (56-market universe) and overlapping-window caveats; a failed calibration is reported, not tuned away.
- F1 scripts live outside server paths and need a non-author review before merge.

## 6. Stop rules (proposal; owner decision needed)
After the **second cohort's F180 look** with a clean F1 and no PASS, Track F stops expanding and the owner decides. Earliest: about 180 days after the second cohort's first evaluated day (with monthly cohorts, roughly seven months after the first cohort starts). Track R continues on its own path. No retry of a failed rule, no re-hashing after seeing data, no resizing after a look.

## 7. Data asset
Keep collecting forward trade-flow, order-book and 1-minute data with manifests; blind windows stay blind.

## 8. Build order (dates KST)
| Step | Work | When |
|---|---|---|
| F0 | this document, review fixes | now |
| F1 | offline calibration and power script, result note | scripts only, outside server paths, non-author review |
| F2 | hosted-runner workflows: breadth fetch and evaluate (first held day 2026-12-06); farm signal recorder (no statistics) | after 11-28 15:00, draft PRs, non-author review |
| F3 | first cohort pre-registration | only after F1 passes and the owner accepts the go/no-go in section 2 |
| F4 | registry rows and Lab tab display (roadmap A1, A5) | after 12-20 |
Workflow and code PRs: draft, non-author review, merge only through the release path or the owner.

## 9. Not decided here
Programme alpha (this design assumes 0.05 a year split over 4 cohorts; owner decision pending), the turnover cap, the go/no-go, the bootstrap block length, the stop rule. Capital and loss limits stay the owner's.

## 10. Not done here
No code, workflow, run, release, gate or policy value. No result is claimed.
