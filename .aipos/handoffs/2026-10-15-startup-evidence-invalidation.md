# Startup evidence invalidation / actual learning boundary

Base:10c153464b40326a061e548cf44abfb479d07fc0.
Branch:fix/paper-startup-evidence-invalidation-20261015.
Work order:WO-OPS-20261015-STARTUP-EVIDENCE-INVALIDATION.
Frozen validated implementation:4373a9473eabbcc58683ce95ac3630199058db90.
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

Fresh non-author review found a remaining race: a commit after recovery reads but
before the final evidence check was detected, yet the pre-change result was still
returned. It also found that synchronous startup aborts after preparation did not
always dispose the five native trackers. The repair retries validation at most
three times, returns explicit RECOVERY_EVIDENCE_UNSTABLE FAIL_CLOSED if evidence
never stabilizes, and cleans prepared evidence on every synchronous startup
failure.

## Completed local gates

Current source head passes18/18 startup regressions, full strict TypeScript emit,
root/mobile typecheck, validate:full, JS lint and security gate on Node24.21 /
TypeScript5.9.3. Security reports zero secrets and zero unmitigated high/critical
advisories. The local changed-test fast hook SKIPs by existing non-primary-CI
policy; the explicit startup suite supplies changed-path coverage. Receipt:
.aipos/evidence/runtime-startup-race-repair-validation-20261016.json. The earlier
170/170 receipt remains historical evidence for b11828bfe, not current-head
authority.

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

On2026-10-15T17:09Z, a governed abandoned-lease reset restored HTTP200 and Research
READY/ticks on still-old runtime89a9ceca, then the scheduler failed closed with
PAPER_WRITER_LEASE_LOST and the supervisor entered stale-lease restart failures.
Pre/post recovery digests of every non-lease canonical table were identical.
No second reset, blind restart or unreviewed deployment was attempted.

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
