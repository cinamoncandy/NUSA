# Handoff — PAPER writer startup bounded fast path

- **Work order:** `WO-OPS-20261017-PAPER-WRITER-STARTUP-FAST-PATH`
- **PR:** #2744
- **Branch:** `fix/paper-writer-startup-lease-20261017`
- **Protected main at this handoff:** `58a8e4fbb32fcc8dee018bd6563982e4e3ba0a8c`
- **Exact review head:** do not trust a SHA recorded in this file; fetch PR #2744 immediately before review and bind the review to that exact head.
- **Authority:** `PAPER_ONLY / liveAuthority=NONE / productionMutationAllowed=false / aiAuthority=ZERO_AUTHORITY`
- This handoff grants no review, Audit, Release, merge, LIVE or production-mutation authority.

## 1. Natural runtime failure reproduced

The Oracle host is still on `/opt/nusa/releases/a4661cc20c47dd3968c3a3575369262c657e3bc1` while the governed successor has not merged/deployed. Read-only host inspection reproduced the old runtime failure without injection:

1. PAPER child starts.
2. Startup spends roughly two minutes before the listener becomes available.
3. `127.0.0.1:41731` briefly listens and Research interval recovery reports READY.
4. The closed-learning scheduler immediately fails with `PAPER_WRITER_LEASE_LOST`.
5. Runtime shuts down and the supervisor restarts it.

Earlier attempts in the same journal also show `PAPER_WRITER_CLOCK_ANOMALY`. Outside the brief startup window local `/health` returned connection failure. The runtime correctly fails closed; the problem is liveness, not a weakened guard.

## 2. What the PR changes

The existing startup path used both a canonical fill ledger and historical account snapshots. When the fill ledger was already populated, replaying every historical account snapshot was redundant and long enough to starve the writer-lease heartbeat.

The bounded path now:

- validates the existing canonical fill ledger sequence, identity and checksums;
- validates the current resumable PAPER account snapshot;
- validates embedded quote/depth/cost receipts, including the tamper case where an outer account checksum is recomputed;
- verifies account checksum/timestamp identity and accounting reconciliation;
- skips full historical account replay only when the canonical fill ledger is already non-empty;
- retains full replay for the empty-ledger migration/backfill case.

No lease TTL, takeover predicate, Risk, capital, qualification, execution authority or learning authority changes.

## 3. Review focus

Please review the exact current PR head as a fresh non-author VALIDATOR and specifically prove or falsify:

1. No full historical replay remains on the non-empty canonical fill-ledger startup path before the heartbeat can begin.
2. Fill-ledger byte/sequence/checksum tamper still fails closed.
3. Persisted quote/depth/cost receipt tamper still fails closed even if an attacker recomputes the outer account checksum.
4. Current account state still reconciles against canonical fill/accounting truth.
5. Empty-ledger migration/backfill still performs the historical reconstruction path.
6. Restart/replay cannot duplicate fills, PAPER state or learning side effects.
7. `PAPER_ONLY / liveAuthority=NONE / productionMutationAllowed=false / aiAuthority=ZERO_AUTHORITY` remains exact.

Blocking findings belong in review threads. Do not mark Ready until P0=0 and P1=0 on the final exact head.

## 4. Validation truth

Before these AIPOS records were added, implementation head `540312118f8edbcf9dec32bd0ff08d1ff171d6b2` had five required companion workflows complete successfully while CI itself was still running. Those runs are historical as soon as this documentation commit moves HEAD. Fresh exact-head CI is mandatory after the AIPOS commit; do not reuse the earlier head as final acceptance.

`git diff --check` was clean. The small PAPER host was intentionally not used as a substitute for canonical CI.

## 5. Learning-loop meaning

This repair does not manufacture learning evidence. Historical owner-baseline periods without Research activation lineage remain ineligible for a genuine closed-learning cycle. The accepted next transition after runtime recovery is:

`stable PAPER runtime -> future authentic Research-qualified challenger binding -> completed canonical PAPER period with COMPLETE cost evidence -> evidence identity -> exactly-once closed-learning cycle -> Research replay -> candidate decision -> Governance/PAPER revalidation`.

Until that happens: `VERIFIED=false`, `PERFORMANCE_IMPROVEMENT=UNPROVEN`, and no qualified cycle/candidate completion is claimed.

## 6. Governance chain after review

Fresh exact-head CI -> fresh non-author VALIDATOR -> deterministic Audit -> Release authorization -> protected-main merge -> exact-main Oracle deploy -> runtime SHA/health/listener -> natural restart/replay -> sustained PAPER evidence. No AI self-approval or direct merge.
