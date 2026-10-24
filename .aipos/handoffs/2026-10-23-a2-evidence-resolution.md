# A2 evidence-resolution handoff — 2026-10-23

Scope: PR #2792 only. No server deployment, Oracle mutation, merge, LIVE authority, or real-money action. Safety remains PAPER_ONLY, liveAuthority=NONE, productionMutationAllowed=false, aiAuthority=ZERO_AUTHORITY.

## Verified starting point

- Protected main at start: c59b522410cb0ea62977382f15d253c331c690f8.
- PR #2792: OPEN / Draft / mergeable; branch feat/learning-input-set-a2; current exact head 70f6dd58f92fb00a8a747abef4d8be84de7ad540.
- Fresh independent review on that head found P1: A2 could persist a well-formed receipt whose Research/PAPER ids did not resolve to canonical stores; a downstream A1 could then consume unverified evidence.
- P2 found that malformed namespace-shaped A2 records could reserve A1 capacity on restart.
- Fresh exact-head review of `66d4ee3fe6f2026cbe31e92915f21fdc17b56cea` found two P2s: sparse caller-shaped arrays at the evidence-resolution boundary could be skipped by `forEach`, and whitespace Research IDs were treated as valid by the shared ledger reservation validator.

## Local repair

- LearningInputSetLedger now requires the existing LearningEvidenceAuthority and verifies every Research and PAPER id plus its exact durable observation timestamp before append and on A2 read/replay, summary, and retention-pin projection.
- Evidence snapshots are indexed once per validation; malformed or ambiguous snapshots fail closed.
- The integration fixture now writes canonical Research history and checksum-valid realized PAPER periods, and tests that ghost references and timestamp mismatches do not create durable A2 receipts.
- The existing shared Evolution Learning ledger now reconstructs A2→A1 reservations only from a complete canonical A2 record with matching content fingerprint, policy fields, lane digests, and retention references. A SQLite restart regression verifies malformed lookalikes do not reserve capacity.
- Durable A2 validation now iterates aligned id/time arrays by index and rejects any non-own array slot before digesting, authority resolution, or append. A production-retention integration regression verifies sparse Research and PAPER arrays append no record and leave the hash-chained ledger replayable.
- The evidence resolver independently checks own id/time array slots by index. The shared ledger reservation validator now matches A2's canonical nonblank Research ID rule, with a restart/capacity regression for whitespace-shaped A2 payloads.
- Existing architecture and storage are reused. No duplicate store, engine, or scheduler was added.

## Validation completed

- Node 24.19.0.
- Build: PASS.
- Focused A2/A1 canonicalization, A2/PAPER retention integration, and evolution learning ledger tests: 44/44 PASS, including sparse-array append rejection and whitespace-ID reservation replay.
- pnpm run preflight: PASS.
- pnpm run validate:full: PASS.
- pnpm run security:gate: PASS.
- git diff --check: PASS.
- Exact-head CI run 39903170341 and required companion workflows: PASS on `4d7750f37a08e7a8196dad25552340fdff27fe00`.
- Fresh Codex review was submitted on that exact head at 2026-10-23T05:07:53Z; it produced no inline findings. Keep PR #2792 Draft.
- A1 PR #2793 is now being synchronized to the reviewed A2 head. Its pre-sync run was cancelled and is historical.

## Next permitted action

Complete the A1 sync in existing PR #2793, run relevant tests and `pnpm run preflight` on Node >=24.19, then exact-head CI and a fresh independent review if CI is green. Do not touch #2855, Oracle, or server deployment; order-book archive server deployment remains after #2855.
