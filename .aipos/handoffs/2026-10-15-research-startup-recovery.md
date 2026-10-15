# Research startup recovery / PAPER deployment blocker

Base7721f159; WO-OPS-20261015-RESEARCH-STARTUP-RECOVERY; branch
codex/paper-startup-research-recovery-20261015. PR2731 policy already merged and
validated but not deployed; runtime89a9ceca still active07:13:36.731Z,healthOK.

Full Research recover is NOT read-only: RUNNING sessions are paused or halted.
Do not run that before exclusive PAPER writer acquisition. This slice prepares
only existing shared ResearchRecoveryCoordinator evidence validation before lease;
actual primary/additional session recovery remains after exclusive acquisition.
Prepared result is bounded to synchronous startup and cleared at start/finally/
stop. Both FAIL_CLOSED and READY retain actual original semantics. No scoring,
promotion, market callback, timer or experiment runs during preparation.

Independent review P1 proved data_version alone misses same-connection evidence
corruption. Fixed with total_changes as well. Actual corrupted champion tests
cover writes before reuse and during preparation. External commits invalidate too.
Legitimate account/lease/session writes conservatively cause fresh validation;
this can still consume lease time. Do not claim all startup stalls fixed, all
validation moved outside lease, host root cause proven or outage prevention.
Intended efficiency: avoid repeated unchanged-evidence validation across variants,
not bypass evidence freshness. No lease timeout/reset/reacquisition change.

35 focused tests PASS, build/typecheck/validate:full/security/lint PASS(24 existing
warnings). First full suite stopped upon review P1; NOT PASS. Fresh fixed-source
full suite and fresh independent review ongoing. No PR opened before localgates.

Regression uses actual compiled production composition and SQLite :memory: with
controlled30001ms preparation delay, no listener/execution; healthy acquisition
works and existing owner refuses B without changing running Research sessions.
Synthetic evidence is not production/runtime-completion proof.

PAPER_ONLY;liveAuthority=NONE;productionMutationAllowed=false;
aiAuthority=ZERO_AUTHORITY. Next: finish local gates/review, exact-head CI/Audit/
Release, then governed deployment/readiness/runtime verification if eligible.

## Final local checkpoint

Frozen implementation9027cbf0c58e085b882503988d668eeb83903087: full pnpm test
PASS1231 isolated files; targeted35 PASS; build/typecheck/validate:full/security
PASS; lint PASS24 existing warnings. Fresh non-author Hubble review binds to this
committed implementation, PASS0/0/0, independently9 negative regressions PASS.
Earlier interrupted suite is not counted. Only AIPOS evidence differs after this
code commit. Current protected main still7721f159; no competing startup PR.
Restore only generated isolated-test-failure.txt deletion; no user cleanup.
Next: draft PR, exact-head CI, independent Audit/Release, postmerge validation,
then bounded canonical PAPER deployment. No old runtime evidence applies to newhead.
