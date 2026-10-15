# Startup evidence invalidation / real learning boundary

Base10c153464b40326a061e548cf44abfb479d07fc0; branch
fix/paper-startup-evidence-invalidation-20261015;
WO-OPS-20261015-STARTUP-EVIDENCE-INVALIDATION. Existing mergedPR2732 is not
reopened. This is its reproduced remaining cache-invalidation defect.

Fresh canonical read-only diagnosis38729127377 at11:41:55.347Z proves current
HTTP200/HEALTHY runtime89a9ceca, not currentmain. Oracle38700547000 failed
readiness300 attempts, observed PAPER_WRITER_LEASE_LOST, rolled back with actual
readiness PASS to89a9ceca. No repeated deployment or forced restart performed.
No claim that the initiating host blocking call is known.

Compiled exact-main baseline9 startup tests PASS. Their production-boundary
stub stopped before real first-orchestrator recover. Including that recovery
exposes global total_changes invalidation by legitimate writer/account/session
writes. A separate controlled-clock test proves30,001ms under-lease revalidation
loses the lease. This is isolated synthetic latency, not fabricated production
failure or an Autopilot canary. Added baseline14 regressions passed12, failed2;
changed-source repair17/17 PASS including five-table corruption, nullable-key
bypass, schema/external changes, ordinary recovery and competing writer refusal.
Full build/typecheck/validators/security are running, not claimed PASS.

Repair uses ephemeral SQLite change sessions over the existing recovery read set,
plus data_version/schema_version. No new canonical store or migration. NULL TEXT
primary keys need explicit checks because SQLite changesets omit those rows.
Trackers close at startup completion/stop; ordinary recovery still revalidates.
No lease TTL, heartbeat, takeover, Risk, qualification, cost or authority change.
External commits still invalidate conservatively; this does NOT prove all startup
stalls fixed or eliminate a single expensive validation or unrelated work delay.

Runtime learning evidence: realizedPeriods15, baselineObservations15, meta-learning
consumed15, cycles0/failures0/holdoutPasses0, RESEARCH_NOT_DEPLOYABLE. Partial baseline
feedback is not a qualified challenger loop or proven investment improvement.
Full current bounded evidence and logical-state mapping are in
.aipos/evidence/runtime-learning-boundary-20261015.json. No historical failure
cause, candidate lineage, fill, cycle or performance is invented.

Next: finish full local gates; publish a draft only after PASS; separate fresh
non-author VALIDATOR review, exact-head CI, canonical Audit/Release and actual
rollout/runtime proof remain required. Codex review recently hit owner usage
limits; automatic Codex workflows are disabled by repository operating policy.
Do not self-approve or turn transpilation into full typecheck evidence.
PAPER_ONLY / liveAuthority=NONE / productionMutationAllowed=false /
aiAuthority=ZERO_AUTHORITY. VERIFIED=false. PERFORMANCE_IMPROVEMENT=UNPROVEN.

Additional bounded concurrency regression: external corruption during the final
variant tracker inspection made the first repair return READY. Baseline test
failed; post-inspection data/schema version recheck now makes all17 PASS. The
earlier full compiler was already running; latest committed-source full gates
must execute before publication. Actual rollback continuity comparison now also
records06:08 vs11:41 process restart with identical114-fill ledger, open period
and realized outcome, observations518->684. This is not cycle replay acceptance.
