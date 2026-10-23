# A2 evidence-resolution handoff — 2026-10-23

Scope: PR #2792 only. No server deployment, Oracle mutation, merge, LIVE authority, or real-money action. Safety remains PAPER_ONLY, liveAuthority=NONE, productionMutationAllowed=false, aiAuthority=ZERO_AUTHORITY.

## Verified starting point

- Protected main at start: c59b522410cb0ea62977382f15d253c331c690f8.
- PR #2792: OPEN / Draft / mergeable; branch feat/learning-input-set-a2; exact head 6f5a703a34335a86e810033e770089437b926486.
- Fresh independent review on that head found P1: A2 could persist a well-formed receipt whose Research/PAPER ids did not resolve to canonical stores; a downstream A1 could then consume unverified evidence.
- P2 found that malformed namespace-shaped A2 records could reserve A1 capacity on restart.
- Fresh exact-head review of `70f6dd58f92fb00a8a747abef4d8be84de7ad540` found another P2: sparse caller-shaped arrays let `forEach` skip holes, allowing an append before receipt parsing failed and permanently consumed capacity.

## Local repair

- LearningInputSetLedger now requires the existing LearningEvidenceAuthority and verifies every Research and PAPER id plus its exact durable observation timestamp before append and on A2 read/replay, summary, and retention-pin projection.
- Evidence snapshots are indexed once per validation; malformed or ambiguous snapshots fail closed.
- The integration fixture now writes canonical Research history and checksum-valid realized PAPER periods, and tests that ghost references and timestamp mismatches do not create durable A2 receipts.
- The existing shared Evolution Learning ledger now reconstructs A2→A1 reservations only from a complete canonical A2 record with matching content fingerprint, policy fields, lane digests, and retention references. A SQLite restart regression verifies malformed lookalikes do not reserve capacity.
- Durable A2 validation now iterates aligned id/time arrays by index and rejects any non-own array slot before digesting, authority resolution, or append. A production-retention integration regression verifies sparse Research and PAPER arrays append no record and leave the hash-chained ledger replayable.
- Existing architecture and storage are reused. No duplicate store, engine, or scheduler was added.

## Validation completed

- Node 24.19.0.
- Build: PASS.
- Focused A2/A1 canonicalization, A2/PAPER retention integration, and evolution learning ledger tests: 43/43 PASS, including sparse-array rejection.
- pnpm run preflight: PASS.
- pnpm run validate:full: PASS.
- pnpm run security:gate: PASS.
- git diff --check: PASS.
- Previous head `70f6dd58f92fb00a8a747abef4d8be84de7ad540`: pull_request CI 39901483096, manual CI 39901477933, and companion workflows PASS; historical after this repair.
- New exact-head CI and independent review: pending.

## Next permitted action

Commit the locally validated sparse-array repair to existing PR #2792, run fresh exact-head CI, and request a new independent review only if CI is green. Keep #2792 Draft. PR #2793's in-flight run was cancelled because it contained the pre-repair A2 head; synchronize A1 only after this corrected A2 head is reviewed. Do not touch #2855, Oracle, or server deployment; the order-book archive server deployment remains after #2855.
