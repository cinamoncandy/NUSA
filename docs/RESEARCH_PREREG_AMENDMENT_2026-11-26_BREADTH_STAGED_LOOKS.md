# Pre-registration amendment: staged looks for the breadth filter (2026-11-26)

Korean summary (한 줄): 폭 필터 판정을 "한 번(2027-06-07)"에서 "30일·60일에 탈락만 확인, 90일에 통과 판정, 183일에 확인"으로 앞당긴다. 규칙, 종목 56개, 첫 보유일(2026-12-06)은 그대로이다.

Amends `docs/RESEARCH_PREREG_BREADTH_FILTER_2026-11-25.md` (the "original"). Owner decision 2026-11-26: the single 183-day wait is too long; the default staged plan was chosen ("기본값대로 해"). Registers on merge before 2026-12-06T00:00Z, before any held day exists. No data value was read for this amendment.

## 1. What does not change
The rule, the fixed list of 56 markets, the equal-weight basket, costs, the first held day (2026-12-06), the seven pass conditions' wording, the placebo construction (10,000 schedules, mulberry32, seed 20261206), the activity band and the defensive-only pass.

## 2. The looks (all computed once each, on a GitHub-hosted runner, from daily candles fetched after the run time)
Held days count from 2026-12-06. A look uses only held days up to its last day, and runs after 03:00Z of its run date (the last daily candle is closed at 00:00Z).

| Look | Held days | Last held day | Run after | Can it end the study? |
|---|---|---|---|---|
| L30 | 30 | 2027-01-04 | 2027-01-05T03:00Z (12:00 KST) | Only as FAIL |
| L60 | 60 | 2027-02-03 | 2027-02-04T03:00Z (12:00 KST) | Only as FAIL |
| L90 | 90 | 2027-03-04 | 2027-03-07T03:00Z (12:00 KST) | PASS, FAIL or NOT_INFORMATIVE |
| L183 | 183 | 2027-06-06 | 2027-06-07T03:00Z (12:00 KST) | Confirmation, or the decision if L90 was NOT_INFORMATIVE |

(L90 runs on 2027-03-07 so the last signal day's candle and a weekend of slack are certain to be closed; held days used are the first 90.)

## 3. Early FAIL rules (L30 and L60 only; they can never pass)
Computed on the held days so far, with the same costs and conventions as the original:
- If the benchmark's maximum drawdown in the window is below 10 percent: record `NO_INFORMATION_YET`, continue.
- Otherwise the study ends as `FAIL_EARLY` if the filtered maximum drawdown is greater than the benchmark's (the filter did not reduce the drawdown at all), or if the filter was invested on fewer than 10 percent or more than 95 percent of the held days (an always-cash or always-in rule).
- Otherwise continue. Nothing else is judged at L30 or L60 and no number is published as evidence of an edge.
Early looks can only reject, never accept, so they add no false-pass chance. They add a small chance of rejecting a rule that would have passed later; this is accepted to learn bad news early.

## 4. L90 (the pass decision)
The seven original conditions apply unchanged to the 90 held days, with H and S of that window in the placebo. The `NOT_INFORMATIVE` test is scaled: benchmark maximum drawdown below 20 percent, or fewer than 75 of the 91 signal days with at least 10 eligible markets. Outcomes:
- `PASS` at L90: eligibility for the owner to consider a separately decided PAPER-only use (original section 4 applies; no live authority, Stage B stays owner-only). L183 is then still run and published as confirmation; if L183 fails the original conditions this is stated first in the result and the PASS is withdrawn.
- `FAIL` at L90: the study ends.
- `NOT_INFORMATIVE` at L90 (no real bear phase yet): not a pass, not a fail; the study continues to L183 under the original conditions and original `NOT_INFORMATIVE` test, and L183 is then the decision.

## 5. Disclosures
- A 90-day pass is weaker evidence than a 183-day pass: fewer independent switches, and a single bear phase can drive it. This is why a pass is only eligibility and L183 confirmation is mandatory.
- Four looks exist; early looks only reject, and L90 plus L183 are the two accept-capable looks (a withdrawal rule covers disagreement). No family-wise correction across studies is applied, as in the original.
- The weekly-trend study will get its own staged-looks amendment after its pre-registration is merged; it is not covered here.

## 6. Not done
No fetch or evaluate workflow exists yet (separate work orders after the 2026-11-28 15:00 KST host freeze ends, as hosted-runner jobs, not host code). If a look cannot run on its date, it runs at the next possible time unchanged and the delay is stated.
