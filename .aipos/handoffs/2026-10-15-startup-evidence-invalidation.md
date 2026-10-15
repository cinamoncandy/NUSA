# Startup evidence invalidation / actual learning boundary

Base:10c153464b40326a061e548cf44abfb479d07fc0.
Branch:fix/paper-startup-evidence-invalidation-20261015.
Work order:WO-OPS-20261015-STARTUP-EVIDENCE-INVALIDATION.
Frozen validated implementation:b11828bfe22f487b63cda5c61b944b41dff9271c.
Later commits change evidence metadata only. Resolve the current Draft PR by this
branch and bind CI/review to its exact published head, not only this source head.
MergedPR2732 is not reopened; this fixes its reproduced invalidation residual.

## Verified defect and repair

The exact-main compiled baseline9 startup tests passed, but the production stub
stopped before actual first-orchestrator recovery. Extending that boundary proved
that normal writer/account/session writes invalidate global total_changes and
re-enter evidence validation under the renewable lease. Isolated controlled-clock
30,001ms revalidation reproduced lease loss. This is synthetic latency in a test,
not a production fault injection, qualifying Autopilot canary or attribution of
the historical host blocking call.

The repair reuses ResearchRecoveryCoordinator and ephemeral SQLite sessions over
its five existing evidence tables, with external data_version/schema_version
checks. NULL TEXT primary keys need explicit guards because changesets omit them.
External commits during final-variant tracker inspection were also reproduced;
post-inspection version checks reject stale READY. Trackers close after startup
or stop; ordinary recovery still revalidates. No new durable model, ledger,
scheduler, dependency, lease TTL, renewal/takeover rule, Risk, cost, qualification
or authority change. External commits still conservatively revalidate; a single
expensive validation or unrelated startup delay can still consume lease time.

## Completed local gates

170/170 focused tests PASS, including17 startup regressions. Full strict TS emit,
root and mobile typecheck PASS in the10GB isolated environment using unchanged
configuration, Node24.19/TS5.9.3. Verified1988 source/type hashes and exact canonical
programme input sets:root1615/mobile739. A real dependency configuration was
copied unchanged. Full repository validators, work-order index, changed JS lint
and security PASS; zero secrets and zero unmitigated high/critical advisories.
TypeScript is outside repository ESLint matching and is covered by the strict
compiler. Local changed-test fast hook SKIPs by existing non-primary-CI policy;
explicit170 tests supplied coverage. Receipt:
.aipos/evidence/runtime-startup-validation-20261015.json.

Prior attempts are not success evidence: the640MB compiler OOMed; the parallel
suite was cancelled with128 passes/4 cancellations; initial shared-symlink
layout made license metadata unavailable. A real frozen private install repaired
the environment without scanner/allowlist exceptions. Initial14 regressions
passed12/failed2; the final-variant race also failed before repair. Final gate
results above supersede pending local checkpoints without erasing those failures.

## Actual runtime evidence and remaining work

Read-only diagnosis38729127377 at11:41:55.347Z proves HTTP200/HEALTHY runtime
89a9ceca, not currentmain. Oracle38700547000 failed300 readiness attempts with
PAPER_WRITER_LEASE_LOST and rolled back with actual readiness PASS. The precise
host initiating blocking call remains unproven; no blind redeploy was attempted.
Actual06:08 vs11:41 restart comparison preserves the114-fill ledger fingerprint,
open period and realized outcome; observations518->684. This is not cycle replay.

RealizedPeriods15, baselineObservations15/meta-learning consumed15,
cycles0/failures0/holdoutPasses0, bootstrapRESEARCH_NOT_DEPLOYABLE. Partial baseline
feedback is not a qualified challenger loop or investment improvement. Evidence:
.aipos/evidence/runtime-learning-boundary-20261015.json and
.aipos/evidence/runtime-learning-rollback-continuity-20261015.json.

Next: Draft exact-head CI and separate fresh non-author VALIDATOR review under
AGENTS.md/GRILL_ME_PROTOCOL; only then Ready/canonical Audit/Release and actual
exact-main rollout/restart/replay acceptance. No self-approval or direct merge.
Closed/unmergedPRs1854,2321,2333 were freshly checked and not revived or pushed.
PAPER_ONLY / liveAuthority=NONE / productionMutationAllowed=false /
aiAuthority=ZERO_AUTHORITY. VERIFIED=false; PERFORMANCE_IMPROVEMENT=UNPROVEN.
