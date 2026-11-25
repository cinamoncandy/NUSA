# Pre-registration: ORDERBOOK+INTRADAY+ALL_KRW+ML 60m, third run (PAPER research)

Status: **PRE-REGISTERED by the owner's decision, 2026-11-25 (KST)** ("등록해, 그 기간으로 진행해"; after the independent review the owner chose to move the span forward: "기간을 앞으로 옮긴다"), **before any order-book VALUE of the span below was examined.** The registration takes effect when this file is merged to main after an independent non-author review, and **it must be on main before 2026-11-26T00:00Z (2026-11-26 09:00 KST), the first training hour; if it is not, this registration is void and a new one with a later span is needed.** Once on main nothing here may change; any change starts a new pre-registration with a new date.
Work order: `WO-RESEARCH-20261125-ORDERBOOK-THIRD-PREREG`. Follows `docs/RESEARCH_PREREG_2026-11-11_ORDERBOOK_60M.md` (second run).

Scope: PAPER research only. No order, no account, no runtime wiring, no limit change. A PASS makes the rule eligible for a forward SHADOW test; it is not promotion evidence.

## 1. Why a third run, why the rules do not change, and the honest risk
- The second run ended `INSUFFICIENT_DATA` (`markets=302, eligible=0`; read by the read-only host diagnosis of 2026-11-25 11:29 KST, run 45533273830). No validation or holdout number was ever produced, so there is nothing to tune against and a re-run on new data is not a reaction to a result.
- **The cause of `eligible=0` is not known.** The eligibility rule in `scripts/run-orderbook-study.js` (line 135) needs, per market, at least 90 percent of the training decision hours (173 of 192) as usable rows, and each decision row needs five books (t, t-15m, t-60m, t-240m, t+60m). One missing hour therefore removes about four decision rows. Candidates: gaps in the second run's training span 2026-11-04..11-12, the median spread bar of 20 bp, or the archive read path (that span was 13 to 21 days old and read mostly from the archive). None is proven.
- The `/health` `orderBookCoverage` figure (182 of 192 hours = 94.8 percent for 2026-11-17..11-25, `meetsStudyBar=true`; the diagnosis also lists 8 gap runs, the longest 5 h) counts one market's hours with a book at time t in the live table only. **It does not prove per-market eligibility.** With 8 gap runs the span 2026-11-17..11-25 would probably fail the 173-row bar, which is why that span is NOT used (it was the first proposal; the owner moved the span forward after the review).
- This is the third run of one study; the repository convention allows one re-run after a documented data repair (`PREREGISTERED_STUDIES_2026-10-21.md`, `marketMicrostructureStore.ts` line 5). The owner decided on 2026-11-25 to run a third. Neither earlier run produced a statistic, so there is no multiplicity cost from the repeat.
- The rules stay exactly those of the second run. Only the span changes.

## 2. Rules
Identical to `scripts/run-orderbook-study.js` as merged (header comment): decision every hour on the hour; book at t = last sample in (t - 2 min, t]; features and standardisation; buy at the best ask, sell at the best bid 60 minutes later; fee 0.05 percent per side, stress 2x fee plus 5 bp per side; L2 logistic regression with lambda in {0.1, 1, 10} chosen by validation mean net per trade; top 3 eligible markets per hour, equal weight; eligible = a book at at least 90 percent of training decision hours and median training spread at most 20 bp, at least 4 eligible markets. K = 195; PASS bar p < 0.05 / 195; at least 50 holdout trades; mean net under stress costs > 0 and better than buying every eligible market at the same hours.

## 3. The only new numbers: the span (UTC), fixed by the owner
| Part | From | To | Length |
|---|---|---|---|
| Train | 2026-11-26T00:00Z | 2026-12-04T00:00Z | 8 days (192 decision hours) |
| Validation | 2026-12-04T00:00Z | 2026-12-07T00:00Z | 3 days |
| Holdout | 2026-12-07T00:00Z | 2026-12-10T00:00Z | 3 days (about 72 decision hours, up to about 216 trades) |

- Decision rows whose 60-minute exit crosses into the next part are dropped, as before.
- **What is unseen.** At registration none of the train, validation or holdout hours exists (the first training hour is 2026-11-26T00:00Z). Nobody may read order-book values of 2026-11-26T00:00Z or later before the run; only counts and timestamps (the coverage probe, the gap probe and the diagnosis) may be read. This is a rule of conduct, not a technical lock. Validation is not blind after the run starts reading it (it only selects lambda); the guarantee that matters is the holdout.
- The script returns `WAITING_DATA` until `now >= END + 2 h`, so the earliest run is **2026-12-10T02:00Z (11:00 KST)** and it can only happen on a research job after the study-script change has reached the host.
- No release or restart inside the span: the freeze 2026-11-24T06:00Z..11-28T06:00Z ends inside it, so the rule rests on the convention of `docs/RESEARCH_CROSSMARKET_ELIGIBILITY_RISK_AND_NEAR_HOLES_2026-11-24.md` (no host release before the holdout end 2026-12-10). A gap is never repaired afterwards and only counts against the 90 percent bar.
- Data comes from the live table and the study archive (`scripts/lib/orderBookSource.js`), read-only. The archive keeps minutes 58, 59 and 0 (exit and t-240m books) and 43 to 45 (t-15m book) of every hour, and holds rows about 75 days (`marketMicrostructureStore.ts`); at a run on 2026-12-10 the training days are 6 to 14 days old. Whether the hourly archiving ran for every training hour, and whether the host's `NUSA_RESEARCH_ORDERBOOK_RETENTION_DAYS` is the default 14 or 28, is **not verified**; a missing hour counts against the 90 percent bar and nothing is filled.
- Overlap disclosed: this span overlaps the cross-market momentum study (train/validation from 2026-11-21, holdout 2026-11-30..12-10). Their signals are related (60-minute return and its cross-sectional rank), so the two holdouts are not independent evidence of each other.

## 4. Preconditions and what happens when they fail
- `INSUFFICIENT_DATA` exactly as before if fewer than 4 markets are eligible or a part is empty; a missing hour is never filled, generated or interpolated.
- If the holdout has fewer than 50 trades the result is recorded as `HOLDOUT_FAIL` / `INSUFFICIENT_DATA`; the rules are not changed and the study is not re-run on the same span. A fourth run would need its own pre-registration and an owner decision.
- Counts-only checks during the span (allowed, no values): the gap probe and the diagnosis list gaps in the hours so far, so a failing eligibility can be predicted early. They change nothing.

## 5. Recording
The result line `ORDERBOOK_STUDY {...}` is read from the service journal by the read-only host diagnosis and recorded in the work order and the ledger with the dataset identity (sha256, row count, range). A PASS is eligible for a SHADOW test only; a FAIL is recorded in the ledger like any other failed configuration.

## 6. What must happen before this can run (separate steps, none done by this document)
1. Owner decision on the span: done on 2026-11-25. Independent non-author review, then merge **before 2026-11-26T00:00Z**: registers this file.
2. Code PR with its own review: a new study id and the span in `SPANS` of `scripts/run-orderbook-study.js`, **and** the study-id allowlists that reject an unknown id: `ORDERBOOK_STUDY_IDS` in `apps/cloud/src/researchStudyResult.ts`, the type and validator in `packages/contracts/src/personalPaperOperations.ts`, `RESULT_STUDY_ID_BY_ROW` in `apps/mobile/src/learningPanelsModel.ts`, plus their tests. It may merge before 2026-12-10 (a release is dispatch-only) but reaches the host only with the first release after 2026-12-10; the run then happens on the next research job after that release.
3. Not done here: any code, workflow, host, rule, threshold, gate, limit or authority change.
