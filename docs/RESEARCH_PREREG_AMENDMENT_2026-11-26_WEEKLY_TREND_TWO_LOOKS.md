# Pre-registration amendment: weekly trend gets a strict look at 13 weeks and the confirmation at 26 (2026-11-26)

Korean summary (한 줄): 주간 추세 판정을 "2027-06-07 한 번"에서 "13주째(2027-03-08 12:00 KST)에 엄격한 기준(0.01)으로 한 번, 못 통과하면 26주째(2027-06-07 12:00 KST)에 0.04 기준으로 한 번"으로 바꾼다. 규칙과 종목은 그대로이고, 둘 중 어느 쪽이든 통과하면 통과이며 거짓 통과 확률은 0.05를 넘지 않는다.

Amends section 2 of `docs/RESEARCH_THREE_DIRECTIONS_2026-11-25.md` (the "original"; PR #3308). Owner decision 2026-11-26: the 26-week wait is too long; chose "a strict single look at 13 weeks plus the 26-week confirmation". Registers on merge before 2026-12-07T00:00Z, before any cohort exists; if it merges later it does not apply and the original stays in force. No data value was read for this amendment.

## 1. What does not change
Lookback 28 days, five picks, seven-day hold, universe and its frozen list, entry and exit rules, costs (stress 10 + 10 bp), benchmark, gap cap, delisting rule, the down-week clause, the leave-one-out clause, the printed-only statistics, the rule that a FAIL is not re-run or retuned, the first decision 2026-12-07, the earliest run time of a look being 03:00Z (12:00 KST) of its date (the reviewer fix of section 2.5 of the original; the options shown to the owner on 2026-11-26 named exactly these times, 2027-03-08 12:00 KST and 2027-06-07 12:00 KST, and the owner chose that option), and the **blind rule**: nobody reads or computes any cohort result before the first look's run time (2027-03-08T03:00Z); counts of fetched candles are allowed, returns are not.

## 2. The two looks (the only two times results are computed)
| Look | Cohorts | Last decision | Last exit | Run after | Alpha per test |
|---|---|---|---|---|---|
| L13 | 13 | 2027-03-01 | 2027-03-08T00:00Z | 2027-03-08T03:00Z (12:00 KST) | 0.01 |
| L26 | 26 | 2027-05-31 | 2027-06-07T00:00Z | 2027-06-07T03:00Z (12:00 KST) | 0.04 |

**PASS if L13 passes or L26 passes.** The two alphas sum to 0.05 (Bonferroni), so the chance of at least one false PASS under the null is at most **nominally** 5 percent for this study (conservative because the looks are positively correlated, and only under the assumptions of the tests themselves: the sign-flip assumes a symmetric null and weekly excess is right-skewed with overlapping lookbacks, as the original admits). Nothing else is computed between or after the looks.

## 2a. What this amendment supersedes in the original (explicit list)
| Original text | Now |
|---|---|
| 2.3 "one primary test, alpha 0.05" | alpha 0.01 at L13 and 0.04 at L26 (sum 0.05) |
| 2.5 item 2 "one calendar decision date 2027-06-07, no early look, no optional stopping" | exactly two looks, L13 and L26, nothing else; no optional stopping |
| 2.5 item 2 "earliest run time ... to be confirmed by the owner" | 03:00Z of each look's date, as above |
| 2.6 item 2 "refuse to run before 2027-06-07T03:00Z" | refuse to run before the look's own run time (2027-03-08T03:00Z for L13, 2027-06-07T03:00Z for L26) |
| 2.6 item 3 "nobody reads or computes a cohort result before 2027-06-07" | before 2027-03-08T03:00Z; after L13 only the verdict, the counts and the clause table are published |

Everything else of the original stands.

## 3. The L13 test (strict)
All of: at least **12 of 13** counted cohorts (the original's 24 of 26, in proportion; fewer is `INSUFFICIENT_DATA`); mean cohort excess > 0 with Student t p < **0.01** (one-sided, **degrees of freedom = counted cohorts minus 1**: 12 with 13 counted, critical t about 2.681; 11 with 12 counted, about 2.718; the p-value is the criterion, the critical t is only illustrative) **and** an **exact sign-flip** p < **0.01** (all 2^n sign patterns of the n counted cohorts enumerated, 8,192 for n = 13 and 4,096 for n = 12, p = share of patterns whose mean is at least the observed mean, the observed pattern included; a sample sd of 0 is a FAIL); mean excess under stress costs > 0; mean excess > 0 after removing the single largest cohort; mean excess on down weeks (benchmark net return < 0) > 0 with a one-sided Student t p < 0.10 on the down-week cohort values and **at least 4 down weeks** (fewer is `INSUFFICIENT_DATA` for that clause, so L13 cannot pass; every other L13 clause is still evaluated and printed). With 4 down weeks the t test has 3 degrees of freedom and p < 0.10 is hard to reach; this is intended (it favours a non-pass at L13). The gap cap applies as in the original.
- L13 `PASS`: the study ends with PASS (a lead for a forward SHADOW replication only, as in the original, section 2.5 item 3; no authority).
- L13 `FAIL` or `INSUFFICIENT_DATA`: **not final**; recorded as "no early pass" and the study continues to L26. L13 can never end the study as a FAIL.

## 4. The L26 test
The original test of section 2.3 on all 26 cohorts (counted cohorts at least 24; degrees of freedom again counted minus 1) with the alpha **0.04** in place of 0.05 for both the t test and the 100,000-flip sign-flip test (fresh flips over all counted cohorts, seed 20261207 as in the original; L13 needs no seed because it enumerates). Everything else (24 of 26 counted, 8 down weeks, stress, leave-one-out) is unchanged. Run only if L13 did not pass.

## 5. Power, disclosed now
At L13 the one-sided critical value is t = 2.681 at 12 degrees of freedom, so the mean weekly excess must exceed about **0.74 sd** just to be significant: about 50 percent power at 0.74 sd and about 85 percent at 1.0 sd. For an assumed weekly excess sd of 4 to 8 percent (a guess; no return was read) that is roughly **3 to 6 percent per week net to pass early**. L13 is therefore a sieve for a very large effect only; a non-pass at L13 says almost nothing. At L26 with p < 0.04 the critical t at 25 degrees of freedom is about 1.80, about 0.35 sd, about 50 percent power at that effect (slightly less than the original's 0.335 sd at 0.05); the down-week and leave-one-out clauses lower the joint power further. A non-PASS is weak evidence against the idea.

## 6. Disclosures
- The early look buys speed only for a large effect; the price is a slightly stricter L26 bar (0.04 instead of 0.05).
- After L13 the results are visible only as the verdict, the counts and the clause table; the L26 rule is **frozen as written here** and cannot be retuned after L13. No further look, interim peek or re-run is allowed.
- No family-wise control across studies, as in the original.
- The fetch and evaluate workflows (hosted runners, own work orders and PRs after the 2026-11-28 15:00 KST host freeze) must implement both looks, refuse to run before each look's run time, and read only candles dated up to that look's last exit.

## 7. Not done
No code, workflow, run or data read by this document. Gates, thresholds, risk limits, capital and authority are unchanged.
