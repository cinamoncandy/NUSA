# Learning-loop slowness diagnosis — 2026-10-26 (read-only)

Author: Claude (CORE, main role). Scope: diagnosis only. No deploy, no runtime change, no risk, threshold or capital change. `authority_impact: none`. PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`.

Re-read live GitHub and a fresh `/health` before acting on anything below. This note is a snapshot.

## Evidence source

Run `40275442510` of `Oracle Host Diagnose` (workflow_dispatch, read-only, 2026-10-26 05:41Z), job `121417107397`: unauthenticated `GET /health` on 127.0.0.1:41731 plus host summary. Protected main was `de6cb5d56acfec429659301c9c1ed8b424e7935f`. The host's `/opt/nusa/current` and the runtime `sourceCommitSha` were both `c59b522410cb0ea62977382f15d253c331c690f8`. The `orderbook_study` and `data_integrity` journal probes returned `*_UNAVAILABLE` (the diagnose user cannot read that journal), so the study result itself is not observable here.

## What the snapshot shows

1. **No PAPER order has been placed.** `decisionCount=12984`, of which `DECISION:PASS:BUY=4824`; `ORDER_INTENT:FAIL=4824`; `paperOrderCount=0`, `paperFillCount=0`, ledger `fillCount=314` with `lastFillAt=1792333922255` (2026-10-18). `previousStop=PREVIOUS_CLOSED_LEARNING_SCHEDULER:PAPER_WRITER_LEASE_LOST`, `eventLoopMaxStallMs=7770` over `eventLoopStallCount=23`. The funnel counts do not carry the `ORDER_INTENT` failure reason, so the exact cause is **not proven**; the writer-lease loss tracked in #2770 is the leading candidate and nothing here should be read as confirming it.
   - The `PERMISSION:SKIP:NO_CANONICAL_TRADE_PERMISSION_EVIDENCE` line is written unconditionally by `apps/cloud/src/runtime.ts` (about line 555) as a funnel label for every tick. It is not evidence that permission evidence blocked the orders.
2. **The research experiment loop never starts a session.** `researchExperimentTicks.counts`: `SKIPPED=110`, all `SKIPPED_DATASET_MANIFEST_MANIFEST_NOT_FOUND`; `sessionsStarted=0`; `closedLearningLoop.cyclesEvaluated=0`, `bootstrap=RESEARCH_NOT_DEPLOYABLE`, `lastBlockedReason=TICK_ERROR` (since 1792974298139).
   - Code path: `researchExperimentComposition.ts` materialises a dataset manifest only after `backfillMarket` returns `COMPLETE` or `fillRecentGaps` returns `NO_GAPS`/`FILLED`; until then `datasetIdForMarket` returns a `missing-dataset-…` id and the runner skips with `MANIFEST_NOT_FOUND`.
   - Data: `researchCandleCount=45108` (required `15840`) but `dataIntegrity.status=WARN`, `candleSeries=1`, `candleRows7d=8590`, `candleStaleSeries=1`, `candleMaxLatestAgeMs=89416950` (about 24.8 h). The candle series is stale, so completeness is not reached. This matches the open stall evidence in PR #2840 / `.aipos/handoffs/2026-10-25-candle-evidence-receipt.md`. Whether the cause is the 1 vCPU host, the event-loop stalls or the collector itself is **not established** by this snapshot.
3. **Meta-learning has nothing to promote.** `experiments=18`, `configurations=443`, `discoveryPasses=15`, `holdoutPasses=0`, `overfitRatePercent=100`, `paperNetBp=-17`, `paperExcessBp=2`, `shadowTrades=737`. `recommendedPrerequisites=COLLECT_ORDERBOOK` is already being served by the order-book collector (`orderBookSamples=4,644,143`, `tradeTicks=966,823`); the pre-registered study may not be read before 2026-10-29 (see the frozen deferral of #2799).
4. **Host headroom is thin.** `/` is 90% used (41G of 45G, 4.7G free; the 11 GB release directory tree is the known large consumer), memory total 954 MB with 377 MB available, one vCPU shared with the runner.
5. **The fixes already in main are not deployed.** Oracle PAPER Release runs `40198892768` and later were cancelled (last 2026-10-25 13:43Z; backup job ran about 149 minutes on a Sunday). The root-helper artifact (#2885) and lease handoff (#2875) are merged but not installed. Cancellation cause is not proven by the logs.

## What this does and does not support

- The learning loop is slow mainly because it has had **no new PAPER fills since 2026-10-18** and **no usable research dataset manifest**, on a runtime that predates the merged fixes.
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
