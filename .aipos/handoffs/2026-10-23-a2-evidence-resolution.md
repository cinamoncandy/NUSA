# A2 evidence-resolution handoff — 2026-10-23

Scope: PR #2792 only. No server deployment, Oracle mutation, merge, LIVE authority, or real-money action. Safety remains PAPER_ONLY, liveAuthority=NONE, productionMutationAllowed=false, aiAuthority=ZERO_AUTHORITY.

## Verified starting point

- Protected main at start: c59b522410cb0ea62977382f15d253c331c690f8.
- PR #2792: OPEN / Draft / mergeable; branch feat/learning-input-set-a2; exact head 6f5a703a34335a86e810033e770089437b926486.
- Fresh independent review on that head found P1: A2 could persist a well-formed receipt whose Research/PAPER ids did not resolve to canonical stores; a downstream A1 could then consume unverified evidence.
- P2 found that malformed namespace-shaped A2 records could reserve A1 capacity on restart.

## Local repair

- LearningInputSetLedger now requires the existing LearningEvidenceAuthority and verifies every Research and PAPER id plus its exact durable observation timestamp before append and on A2 read/replay, summary, and retention-pin projection.
- Evidence snapshots are indexed once per validation; malformed or ambiguous snapshots fail closed.
- The integration fixture now writes canonical Research history and checksum-valid realized PAPER periods, and tests that ghost references and timestamp mismatches do not create durable A2 receipts.
- The existing shared Evolution Learning ledger now reconstructs A2→A1 reservations only from a complete canonical A2 record with matching content fingerprint, policy fields, lane digests, and retention references. A SQLite restart regression verifies malformed lookalikes do not reserve capacity.
- Existing architecture and storage are reused. No duplicate store, engine, or scheduler was added.

## Validation completed

- Node 24.19.0.
- Build: PASS.
- Focused A2 canonicalization, A2/PAPER retention integration, and evolution learning ledger tests: 42/42 PASS.
- pnpm run preflight: PASS.
- pnpm run validate:full: PASS.
- pnpm run security:gate: PASS.
- git diff --check: PASS.

## Next permitted action

Recheck protected main and PR #2792 head. Commit the validated change only if remote branch still equals the verified starting head, push non-forcing to the existing branch, run exact-head CI, and request a fresh independent review only after CI is green. Keep PR #2792 Draft. Do not touch #2855, Oracle, or server deployment; the order-book archive server deployment remains after #2855.
