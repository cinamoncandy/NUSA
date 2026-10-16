# Research run fingerprint verification

Work order: WO-RESEARCH-20261016-RUN-FINGERPRINT.
Branch: codex/research-run-fingerprint-20261016.
Base: 9a2c235d9576689eb4c374988e57f9cc8afd5558.

Qualification previously checked digest shape only. A negative regression proved
that a substituted digest was accepted. The canonical producer hash is now shared
unchanged with qualification, which recomputes it before candidate classification.
Independent compatibility test reconstructs the historical schema1 material.
Explicitly resealed synthetic fixtures preserve their existing semantic assertions.
No thresholds, evidence history, schema version, authority or persistence changed.

48 focused tests and1231 isolated test files PASS. Build, typecheck, validate:full,
security and lint PASS (24 existing warnings). Fresh non-author Confucius review
PASS_WITH_NOTES,0P0/0P1/0P2; independently44 tests PASS. Reviewer reconfirmed all
four blobs at implementation6959b529f67270462d239de793c2fd42007e0885.

Next: commit metadata, reconfirm final review binding, inspect fresh main and
duplicate PRs, then draft PR/exact-head CI/canonical Audit/Release. Restore only
generated isolated-test-failure.txt deletion. No AI merge or approval.

Schema1 direct material excludes some top-level fields. Integrity is not
authentication, durable precommit, an A-grade ROBUST receipt or actual profitability.
All master acceptance remains UNVERIFIED. Reuse canonical issue1094/Research Factory.
Previous slice PR2736 merged at the base above; its CI38825549618,
Audit/Release38826134647 and post-merge CI38826272673 succeeded. Do not redo it.

PAPER_ONLY; liveAuthority=NONE; productionMutationAllowed=false;
aiAuthority=ZERO_AUTHORITY. No runtime deployment or actual learning completion
is claimed by this source-only validation repair.
