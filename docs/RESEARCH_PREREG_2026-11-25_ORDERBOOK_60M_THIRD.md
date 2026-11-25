# Pre-registration: ORDERBOOK+INTRADAY+ALL_KRW+ML 60m, third run (PAPER research)

Status: **PRE-REGISTERED by the owner's decision, 2026-11-25 (KST) ("등록해, 그 기간으로 진행해"), before any order-book VALUE of the span below was examined**; only counts of hours with a book were read (below). The registration takes effect when this file is merged to main after an independent non-author review. Once on main nothing here may change; any change starts a new pre-registration with a new date.
Work order: `WO-RESEARCH-20261125-ORDERBOOK-THIRD-PREREG`. Follows `docs/RESEARCH_PREREG_2026-11-11_ORDERBOOK_60M.md` (second run).

Scope: PAPER research only. No order, no account, no runtime wiring, no limit change. A PASS makes the rule eligible for a forward SHADOW test; it is not promotion evidence.

## 1. Why a third run, and why the rules do not change
- The second run ended `INSUFFICIENT_DATA` (`markets=302, eligible=0`, host reading of 2026-11-25 11:29 KST). No validation or holdout number was ever produced, so there is nothing to tune against.
- Most likely cause (not proven): its training span 2026-11-04..2026-11-12 lies in the period of 68.8 percent coverage (reading of 2026-11-20), below the per-market bar of 90 percent of training hours (`scripts/run-orderbook-study.js` line 135).
- Since then the collector ran without a restart (release `42a9c182`, started 2026-11-23 18:00 KST) and `/health` `orderBookCoverage` for the last 192 hours reads 182 hours = 94.8 percent, longest gap 5 h, `meetsStudyBar=true` (host reading of 2026-11-25). That is a count of hours with rows, not a value.
- Because the per-market eligibility (a book in at least 90 percent of training hours, median spread at most 20 bp, at least 4 eligible markets) is a precondition and not a tuning knob, the rules stay exactly those of the second run.

## 2. Rules
Identical to `scripts/run-orderbook-study.js` as merged (header comment): decision every hour on the hour; book at t = last sample in (t - 2 min, t]; features and standardisation; buy at the best ask, sell at the best bid 60 minutes later; fee 0.05 percent per side, stress 2x fee plus 5 bp per side; L2 logistic regression with lambda in {0.1, 1, 10} chosen by validation mean net per trade; top 3 eligible markets per hour, equal weight. K = 195; PASS bar p < 0.05 / 195; mean net under stress costs > 0 and better than buying every eligible market at the same hours.

## 3. The only new numbers: the span (UTC), fixed by the owner
| Part | From | To | Length |
|---|---|---|---|
| Train | 2026-11-17T00:00Z | 2026-11-25T00:00Z | 8 days (192 h, exists now) |
| Validation | 2026-11-25T00:00Z | 2026-11-28T00:00Z | 3 days |
| Holdout | 2026-11-28T00:00Z | 2026-12-10T00:00Z | 12 days |

- Decision rows whose 60-minute exit crosses into the next part are dropped, as before.
- Validation and most of the holdout do not exist yet, so the holdout is a true forward test. Nobody may read order-book values from 2026-11-28T00:00Z on before the run. The run may not start before 2026-12-10T00:30Z, which is also the earliest host release (the holdout of the cross-market study ends the same day), so no restart is expected inside the span.
- Data comes from the live table and the study archive (`scripts/lib/orderBookSource.js`), read-only. The live table keeps 14 days, so the train hours before 2026-11-26 are served by the archive (minutes 58, 59 and 0 of every hour, kept 61 days), which the study's "last sample in (t - 2 min, t]" rule reads. Whether the archive holds every training hour is **not verified** and is checked by the run itself (a missing hour counts against the 90 percent bar; nothing is filled).
- 12 holdout days give about 288 decision hours; the holdout needs at least 50 trades.

## 4. Preconditions and what happens when they fail
- `INSUFFICIENT_DATA` exactly as before if fewer than 4 markets are eligible or a part is empty; a missing hour is never filled, generated or interpolated.
- If the holdout has fewer than 50 trades the result is recorded as `HOLDOUT_FAIL` / `INSUFFICIENT_DATA`; the rules are not changed and the study is not re-run on the same span.
- A host stall that leaves a gap is not repaired afterwards. No release or restart inside the span (freeze until 2026-11-28 15:00 KST, then the holdout rule until 2026-12-10).

## 5. Recording
The result line `ORDERBOOK_STUDY {...}` is read from the service journal by the read-only host diagnosis and recorded in the work order and the ledger with the dataset identity (sha256, row count, range). A PASS is eligible for a SHADOW test only; a FAIL is recorded in the ledger like any other failed configuration.

## 6. What must happen before this can run (separate steps, none done)
1. Owner decision on the span: done on 2026-11-25 ("그 기간으로 진행해").
2. Independent non-author review, then merge: registers this file.
3. A new study id and the span in `scripts/run-orderbook-study.js` (a constants change guarded by the study id) in its own PR with review, reaching the host with the first release after 2026-12-10. The run then happens on the next research job after that release; the data stays in the archive for 61 days.
4. Not done here: any code, workflow, host, rule, threshold, gate, limit or authority change.
