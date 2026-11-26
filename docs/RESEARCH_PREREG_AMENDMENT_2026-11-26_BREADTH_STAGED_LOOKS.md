# Pre-registration amendment: staged looks for the breadth filter (2026-11-26)

Korean summary (한 줄): 폭 필터 판정을 "한 번(2027-06-07)"에서 "30일·60일에 탈락만 확인, 90일에 통과 판정, 183일에 확인"으로 앞당긴다. 규칙, 종목 56개, 첫 보유일(2026-12-06)은 그대로이다.

Amends `docs/RESEARCH_PREREG_BREADTH_FILTER_2026-11-25.md` (the "original"). Owner decision 2026-11-26: the single 183-day wait is too long; the default staged plan was chosen ("기본값대로 해"). Registers on merge before 2026-12-06T00:00Z, before any held day exists. If it merges later, it does not apply and the original stays in force unchanged. Where this amendment conflicts with the original, it supersedes the original's Korean summary line, section 3 sentences that say the study is judged "once" or has "one decision", and the NOT_INFORMATIVE paragraph's extension sentence; everything else of the original stands. No data value was read for this amendment.

## 1. What does not change
The rule, the fixed list of 56 markets, the equal-weight basket, costs, the first held day (2026-12-06), the seven pass conditions' wording, the placebo construction (10,000 schedules, mulberry32, seed 20261206), the activity band and the defensive-only pass.

## 2. The looks (all computed once each, on a GitHub-hosted runner, from daily candles fetched after the run time)
Held days count from 2026-12-06. A look uses only held days up to its last day, and runs after 03:00Z of its run date (the last daily candle is closed at 00:00Z).

| Look | Held days | Last held day | Run after | Can it end the study? |
|---|---|---|---|---|
| L30 | 30 | 2027-01-04 | 2027-01-05T03:00Z (12:00 KST) | Only as FAIL |
| L60 | 60 | 2027-02-03 | 2027-02-04T03:00Z (12:00 KST) | Only as FAIL |
| L90 | 90 | 2027-03-05 | 2027-03-07T03:00Z (12:00 KST) | PASS, FAIL or NOT_INFORMATIVE |
| L183 | 183 | 2027-06-06 | 2027-06-07T03:00Z (12:00 KST) | Confirmation, or the decision if L90 was NOT_INFORMATIVE |

(L90 uses the first 90 held days, 2026-12-06 to 2027-03-05, whose signals are the 90 signal days 2026-12-05 to 2027-03-04; it runs on 2027-03-07, after the 2027-03-05 candle closed at 2027-03-06T00:00Z. Lookback candles before 2026-12-06 and the 10-eligible-market rule are exactly as in the original.)

## 3. Early FAIL rules (L30 and L60 only; they can never pass)
Computed on the held days so far (the benchmark drawdown is that look's window only), same costs and conventions as the original. Order of evaluation:
1. If the benchmark's maximum drawdown in the window is below 10 percent: record `NO_INFORMATION_YET` and continue; nothing below is evaluated.
2. Otherwise the study ends as `FAIL_EARLY` if the filtered maximum drawdown is **not smaller** than the benchmark's (ties count as failure; a filter that held cash has drawdown 0 and does not fail here).
3. At L60 only: also `FAIL_EARLY` if the filter was invested on fewer than 10 percent of the held days.
4. Otherwise continue. Nothing else is judged at L30 or L60, and no number from them is evidence of an edge. The upper activity cap is deliberately not used early (a slow bull-to-bear transition can keep a valid filter invested for 60 days); the original 90 percent cap applies at L90 and L183.
Early looks can only reject, never accept. They lower power slightly (a rule that would have passed can be killed by one early whipsaw); this is accepted to learn bad news early. The early thresholds (10 percent benchmark drawdown, 10 percent activity) are my choice and were not power-tested.

## 4. L90 (the pass decision)
The seven original conditions apply unchanged to the 90 held days, with H and S of that window in the placebo. The `NOT_INFORMATIVE` test is scaled: benchmark maximum drawdown below 20 percent, or fewer than 75 of the 90 signal days with at least 10 eligible markets. Outcomes:
- `FAIL` at L90: the study ends.
- `PASS` at L90: provisional. The owner may then consider PAPER-only shadow use (the whole system is PAPER-only; no live authority, Stage B stays owner-only), and nothing beyond that may be considered before L183. L183 is always run with the original conditions, the original `NOT_INFORMATIVE` test and H and S of the full 183-day window. **The L90 PASS stands only if L183 is `PASS`**; if L183 is `FAIL` it is withdrawn, and if L183 is `NOT_INFORMATIVE` or fails to run it stays unconfirmed (not a pass). The result note states the L183 outcome first.
- `NOT_INFORMATIVE` at L90 (no real bear phase yet): not a pass, not a fail; the study continues and L183 under the original conditions is the decision.

## 5. Disclosures
- A 90-day pass is weaker evidence than a 183-day pass: fewer independent switches, and a single bear phase can drive it. This is why a pass is only eligibility and L183 confirmation is mandatory.
- Four looks exist. Early looks only reject. L90 is a second accept-capable look, so an L90 PASS alone is not evidence and gives no extra false-pass protection; the final bar is L183 (an L90 pass that L183 does not confirm is withdrawn). The practical gain of the staging is early bad news and an early provisional signal, not an earlier verdict. No family-wise correction across studies is applied, as in the original.
- The weekly-trend study will get its own staged-looks amendment after its pre-registration is merged; it is not covered here.

## 6. Not done
No fetch or evaluate workflow exists yet (separate work orders after the 2026-11-28 15:00 KST host freeze ends, as hosted-runner jobs, not host code). If a look cannot run on its date, it runs at the next possible time with the first successful fetch, never re-run to change an outcome, and the delay is stated.
