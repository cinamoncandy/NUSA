# Learning-loop slowness diagnosis — 2026-10-26 (read-only)

Author: CORE session. Scope: diagnosis only. No deploy, no runtime change, no risk, threshold or capital change. `authority_impact: none`. PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`.

Re-read live GitHub and a fresh `/health` before acting on anything below. This note is a snapshot.

## Evidence source

Run `40275442510` of `Oracle Host Diagnose` (workflow_dispatch, read-only, 2026-10-26 05:41Z), job `121417107397`: unauthenticated `GET /health` on 127.0.0.1:41731 plus host summary. Protected main was `de6cb5d56acfec429659301c9c1ed8b424e7935f`. The host's `/opt/nusa/current` and the runtime `sourceCommitSha` were both `c59b522410cb0ea62977382f15d253c331c690f8`. The `orderbook_study` and `data_integrity` journal probes returned `*_UNAVAILABLE` (probably a journal read permission, which is an inference: the log only shows the `*_UNAVAILABLE` values and a `Permission denied` on `/opt/nusa/.previous-release`), so the study result itself is not observable here.

## What the snapshot shows

1. **No PAPER order has been placed.** `decisionCount=12984`, of which `DECISION:PASS:BUY=4824`; `ORDER_INTENT:FAIL=4824`; `paperOrderCount=0`, `paperFillCount=0`, ledger `fillCount=314` with `lastFillAt=1792333922255` (2026-10-18). `previousStop=PREVIOUS_CLOSED_LEARNING_SCHEDULER:PAPER_WRITER_LEASE_LOST`, `eventLoopMaxStallMs=7770` over `eventLoopStallCount=23`. `ORDER_INTENT:FAIL` is recorded for any result other than a fill or a wait (BLOCKED, REJECTED, DUPLICATE or FAILED: `runtime.ts` about line 576), the funnel carries no reason and no `RISK:*` counts, and `lastError` is `null`. The candidates are therefore **not ranked**; a writer-lease loss (#2770) is one of them. Note `previousStop` describes the *previous* process: the current one started 2026-10-26T00:30Z.
   - The `PERMISSION:SKIP:NO_CANONICAL_TRADE_PERMISSION_EVIDENCE` line is written unconditionally by `apps/cloud/src/runtime.ts` (about line 555), but `paperLearningObservability.ts` (lines 193-197) rewrites it to `NOT_EVALUATED_NO_ACTIONABLE_DECISION` when the decision is not BUY or SELL (8,160 of 12,984); only the 4,824 BUY decisions keep the label. It is a funnel label, not evidence that permission evidence blocked the orders.
2. **The research experiment loop never starts a session.** `researchExperimentTicks.counts`: `SKIPPED=110`, all `SKIPPED_DATASET_MANIFEST_MANIFEST_NOT_FOUND`; `sessionsStarted=0`; `closedLearningLoop.cyclesEvaluated=0`, `bootstrap=RESEARCH_NOT_DEPLOYABLE`, `lastBlockedReason=TICK_ERROR` (since 1792974298139).
   - The same counters also show `FAIL_EXCESSIVE_DRAWDOWN=79`, `FAIL_NO_EDGE=26` and `REPEAT_*=5` while `sessionsStarted=0`; this combination is **unexplained** here.
   - Code path: `researchExperimentComposition.ts` materialises a dataset manifest only after `backfillMarket` returns `COMPLETE` or `fillRecentGaps` returns `NO_GAPS`/`FILLED`; until then `datasetIdForMarket` returns a `missing-dataset-…` id and the runner skips with `MANIFEST_NOT_FOUND`.
   - Data: `researchCandleCount=45108` (required `15840`) but `dataIntegrity.status=WARN`, `candleSeries=1`, `candleRows7d=8590`, `candleStaleSeries=1`, `candleMaxLatestAgeMs=89416950` (about 24.8 h, **as of `dataIntegrity.observedAt` 2026-10-26T00:18:33Z**, 5 h 23 min before this snapshot and before the current process started). The candle series being stale is consistent with completeness not being reached (not proven as the sole cause). The manifest also depends on the canonical 12-day window: PR #2840 records a source gap `2026-10-18T17:02Z..22:04Z` that must not be synthesised, with the earliest natural aging boundary about 2026-10-31 07:04 KST, so `MANIFEST_NOT_FOUND` may not clear right after a deploy. This matches the open stall evidence in PR #2840 / `.aipos/handoffs/2026-10-25-candle-evidence-receipt.md`. Whether the cause is the 1 vCPU host, the event-loop stalls or the collector itself is **not established** by this snapshot.
3. **Meta-learning has nothing to promote.** `experiments=18`, `configurations=443`, `discoveryPasses=15`, `holdoutPasses=0`, `overfitRatePercent=100`, `paperNetBp=-17`, `paperExcessBp=2`, `shadowTrades=737`. `recommendedPrerequisites=COLLECT_ORDERBOOK` is already being served by the order-book collector (`orderBookSamples=4,644,143`, `tradeTicks=966,823`); the pre-registered study may not be read before 2026-10-29 (see the frozen deferral of #2799).
4. **Host headroom is thin.** `/` is 90% used (41G of 45G, 4.7G free; memory total 954 MB with 377 MB available, from this log). The "11 GB release directory tree" and "one vCPU" figures come from the 2026-10-15 handoff, not from this log.
5. **Two of the merged fixes are not deployed.** The deployed runtime `c59b522` is the merge commit of #2855, so #2855 is deployed. The root-helper artifact (#2885) and the lease handoff (#2875) are merged but not installed. Oracle PAPER Release run `40198892768` (started 2026-10-25T13:43:07Z, ended about 16:58Z) was cancelled. The #2770 comment of 2026-10-26T04:08Z gives about 149 minutes for that run's backup step on a Sunday; this snapshot does not show it. The cancellation cause is not proven by the logs.

## What this does and does not support

- The slowness is **consistent with** there having been **no new PAPER fills since 2026-10-18** and **no usable research dataset manifest**, on a runtime that predates the merged fixes. These are observed states, not proven causes.
- It does **not** show the strategies are bad or good: `VERIFIED=false`, investment improvement `UNPROVEN`.
- It does **not** show that the order failure is the writer lease. Confirming that needs the failure reason (the `ORDER_INTENT` reason or the advanced diagnostic line in the app), which `/health` does not expose in its funnel counts.

## Ordered next actions (all outside this PR)

1. Approved exact-main Oracle deployment on a weekday (a weekday avoids the Sunday full backup), with the installed exact reviewed root-owned helper and actual backup/readiness evidence. Do not retry the release blindly; no synthetic fill, no risk relaxation, no duplicate writer.
2. Right after a successful deploy: re-run `Oracle Host Diagnose` with `health_only=true` and check, in order: `paperOrderCount` rises from a genuine decision, `candleMaxLatestAgeMs` falls, `researchExperimentTicks.counts` stops showing `MANIFEST_NOT_FOUND`, `previousStop` is not a lease loss.
3. Free host disk (old release directories) through the approved ops path; do not delete anything from this session.
4. Make the `ORDER_INTENT` failure reason visible in `/health` funnel counts (display-only change) so the next diagnosis does not have to infer it. Not done here.
5. Read the order-book study result no earlier than 2026-10-29T03:30Z and record it in `docs/research-ledger/experiments.json` and AIPOS. Keep #2799 deferred until then.

## Not verified

- Anything after 2026-10-26 05:41Z, any server state beyond `/health` and the host summary, the cause of the `ORDER_INTENT` failures, the cause of the candle stall, and the order-book study result.


## Added after independent review

- The ORDER_INTENT:FAIL count has no RISK:* counts next to it, and `runtime.ts` records a RISK event only when a risk result exists. So the failures likely happened before or without a risk result. This is an inference, not proof.
- `lastBlockedAt` 1792974298139 is 2026-10-26T00:24:58Z, which is before the current process start, so it is not a reading of the current process.
