# Cloud qualification identity boundary

WO-RESEARCH-20261016-CLOUD-IDENTITY; branch codex/research-cloud-identity-20261016.
Base c26eb5b585d480b7cbe4e653fc8aadbb50e67f4f.

Observed2 RED regressions: Cloud codec dropped a valid validationIdentity and
accepted missing identity. Existing policy metadata/hash construction extracted
to contracts/researchQualificationIdentity; desktop remains classification owner.
Cloud verifies current policy/run/full payload before deployment projection and
retains frozen identity. Raw versus normalized payload must match, so whitespace
or unknown fields cannot silently change the receipt's meaning.

Pinned pre-extraction policy SHA6d1ea806bdb5056f2b3ab095033b127a53fe74b0c8a92dbb1030adfa3235f542
and independent synthetic result SHA32a11896262117f9a272dc936218639a751ffa8592676c81c6d5671735c5f330
remain compatible. Actual finalizer output traverses Cloud codec unchanged in a
separate test. Synthetic bootstrap/adapter/history fixtures bind their actual
payloads with the same contract; existing assertions retained. Initial compile
reported missing fixture fields/read-only negative-fixture mutation; fixed the
fixtures, not production assertions. Final build and53 focused tests PASS.
Typecheck/validate:full/security/lint PASS (24 existing warnings).
Full suite1232 isolated files PASS. Fresh independent reviewer Curie returned
PASS_WITH_NOTES0P0/0P1/1P2, independently53 tests and13 rejection probes PASS.
Implementationbe4495772f78dcb60834371a7951646d826e8e0d; reviewer confirmed all9
implementation/test blobs at that exact commit.
P2: binder expects an unbound payload; rebinding an already-bound payload makes
its checksum unverifiable (fail-closed). All actual producer callers supply
unbound payloads. This is a documented API misuse limitation, not hidden PASS.

No new evaluator/persistent store/control plane. Numeric thresholds unchanged.
This is consistency, not authentication, durable precommit or full A-grade.
Old archived snapshots unchanged. New parent codec and worker must ship as the
same canonical release bundle; old worker responses without identity fail closed.
No ad-hoc host copy or mixed-version deployment; actual deployment unverified.

Next: final metadata-head review; then draft PR/exact-head CI,
canonical independent Audit/Release and post-merge CI. No AI approval or merge.
Generated isolated-test-failure.txt deletion is restored after the completed suite.
PAPER_ONLY/liveAuthority=NONE/productionMutationAllowed=false/aiAuthority=ZERO_AUTHORITY.
