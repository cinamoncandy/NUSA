# Alpha Lab 2: Track R first, a small forward test farm second (DESIGN PROPOSAL, 2026-11-26)

Korean summary (한 줄): 사장님이 "작은 농장 + 트랙 R 우선"으로 설계하라고 했다(2026-11-26). 이 문서는 **제안**이며 코드, 실행, 서버 변경이 없다. 농장은 **작게(한 묶음 최대 48개 규칙)** 시작하고, 먼저 **가짜 통과율을 재는 교정**을 통과해야만 진짜 규칙을 넣는다. 못 찾으면 "못 찾았다"가 정답이다.

Status: **PROPOSAL, docs only, needs a non-author review before any build.** PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `realOrderAuthority=false`, `aiAuthority=ZERO_AUTHORITY`, FAIL_CLOSED. Server-code PRs stay frozen until 2026-11-28 15:00 KST; no host release before the owner says so. Builds on `docs/ALPHA_LAB_COMPLETION_ROADMAP_2026-11-26.md` (A1 to A8, G1 to G5). Nothing here loosens a gate, bar or threshold.

## 1. Why a farm at all, and why small
The bottleneck is independent evidence per calendar day: one rule per six-month study yields little information per day. A farm evaluates a **fixed, hashed cohort** of rules every day on public candles, so one wait tests many rules together. It does **not** add statistical power: more rules means a stricter family-wise bar. So the farm is a way to use time well and to measure our false-pass rate, not a source of edge.

## 2. Honest power check (back-of-envelope, to be recomputed by the review)
Assume crypto daily volatility near 3 to 4 percent. The standard error of an annualized Sharpe ratio over T years is about 1 / sqrt(T). Over 0.5 year that is about 1.4. A single one-sided test at 5 percent needs a true Sharpe near 2.3; a family-wise bar over 48 rules (z near 3) needs about 4. Costs (15 bp per side daily) come on top. Consequences stated up front:
- A 90 or 180 day look can only detect a **very large** effect; "nothing passes" is the expected outcome.
- Therefore cohort looks are registered at **L90 (reject-only), L180 and L365**; a PASS needs the L180 bar and L365 confirmation before it can feed any candidate state. (Exact looks, alpha split and bar are fixed in the cohort pre-registration, not here.)
- If this arithmetic is wrong, the review must say so before the farm is built.

## 3. Track R first (already registered, no new test)
Track R is the defensive breadth overlay (a risk-managed basket that reduces exposure when breadth is weak). Its evidence path is already frozen in `docs/RESEARCH_PREREG_AMENDMENT_2026-11-26_BREADTH_STAGED_LOOKS.md`: L30 2027-01-05, L60 02-04, L90 03-07, L183 06-07 (03:00Z). L90 pass stands only if L183 passes. Track R's goal is lower drawdown, not excess return, and it needs its own pass of the registered conditions to become a candidate. This design adds **no new bar** for Track R; it adds only the hosted-runner fetch and evaluate workflows (roadmap A3) and a monthly status line in the weekly report. Cross-venue evidence (`docs/RESEARCH_CROSSVENUE_BREADTH_RESULT_2026-11-26.md`) was a FAIL with near misses, so Track R carries survivor and near-miss caveats into every report.

## 4. The small farm (Track F)
- **Cohort**: at most **48 rules**, frozen with a hash and K = 48 (plus the K of any parent screen) **before** the first evaluated day. One new cohort per month at most; the number of cohorts per year is capped (proposal: 4) so the programme alpha (roadmap section 3, owner decision pending) can be spent explicitly.
- **Rule form**: low turnover only (cost wall first, roadmap G4); daily public candles; long or flat on spot; a fixed grammar declared before the run. Rules touching S2 to S4 holdout prices (2026-11-05 to 12-05) or order-book values from 2026-11-25T19:00Z before 2026-12-10 are not allowed.
- **Null controls**: for every cohort, 48 matched random-schedule controls (same exposure and turnover profile, mulberry32 seeds frozen). The share of controls that pass the same family-wise bar is **reported and is itself a gate**: if the control pass rate exceeds the nominal alpha by a pre-registered margin, the cohort result is NOT_INFORMATIVE.
- **Test**: one stationary-bootstrap max statistic across the cohort (Romano-Wolf step-down style) on net-of-cost daily returns; reject-only early look; confirmation looks as in section 2. Exact statistic and block length are fixed in the cohort pre-registration and reviewed by a non-author.
- **Outputs**: append-only registry rows (roadmap A1) with hash, K, looks, verdicts; no order ids; no order path; a PASS only moves a rule to "shadow candidate", never to PAPER or live.

## 5. Calibration gate before any real rule (F1)
Before a real cohort is registered, run an **offline calibration on rules that cannot contain edge**: random schedules on already-read history (not holdout, not order-book), many repetitions, same code path as the farm. Required: the family-wise false-pass rate at the bar is at or below the nominal alpha (with a stated Monte Carlo interval), and the control pass rate logic works. If calibration fails, no real cohort is registered until the method is fixed and reviewed. A failed calibration is reported, not tuned away.

## 6. Stop rules (proposal; owner decision needed)
- After two real cohorts (about six months of looks) with no PASS and a clean calibration, the farm stops expanding; the owner decides whether to continue, change the rule family, or end Track F.
- Track R continues on its own registered path regardless.
- No retry of a rule that failed; no re-hashing after seeing data; no cohort resized after a look.

## 7. Data asset (continues, no new risk)
Keep collecting forward trade-flow, order-book and 1-minute data with manifests, time alignment and source records. Blind windows above stay blind.

## 8. Build order (proposed; dates KST)
| Step | Work | When |
|---|---|---|
| F0 | this document, non-author review, fixes | now |
| F1 | offline calibration script (random rules only), result note | docs or scripts, may precede 11-28; no host change |
| F2 | hosted-runner workflows for breadth fetch and evaluate (first held day 2026-12-06) and the farm's daily calculator | after 11-28 15:00, draft PRs, non-author review |
| F3 | first cohort pre-registration (rules, K, controls, bar, looks) | only after F1 passes; before any evaluated day |
| F4 | registry rows and Lab tab display (roadmap A1, A5) | after 12-20 |
Workflow and code PRs: draft, non-author `/grill-me` review, merge only through the release path or by the owner.

## 9. What is not decided here
Programme alpha, the cohort cap per year, the margin for control pass rate, the exact bar, and whether Track F continues after the stop rule. Capital and loss limits stay the owner's (`docs/LIVE_CANARY_LOSS_LIMIT_PROPOSAL_2026-11-26.md` is parked until a candidate exists).

## 10. Not done here
No code, workflow, run, release, gate or policy value. No result is claimed.
