# Exact PAPER deployment replay

WO-OPS-20261015-PAPER-DEPLOYMENT-REPLAY; baseaa749640;
branchcodex/paper-deployment-exact-replay-20261015.

Stateful port regression reproduces an existing recovery defect: deployment
opens its period, but a coordinator receipt append interruption causes identical
deployment replay to fail "another PAPER realized period is already open".
Old duplicate-deploy fixture omitted listOpenPeriods, hiding this case.
Not a diagnosed cause of current runtime cycles0/holdout0.

Minimal branch after current Governance verification recognizes only exact
periodId/market/account boundary, recomputed period advisory/provenance binding,
active binding and Research lineage. It returns the same receipt without
reopening the period, resetting observations or mutating binding state.
Different/stale account boundaries are deliberately not accepted by this slice.
Tests deny changed market/time/advisory/dataset, missing active binding and
withdrawn Governance permission; preserve observations and binding event count.

Build/typecheck/validate:full/security PASS;lint PASS24 existing warnings.
28 bootstrap/deployment tests PASS;36 including coordinator PASS (initial dot
output miscount40 corrected from explicit TAP summary). Review P2 invalid paired
observation fixture corrected; latest focused run36 PASS. Full isolated
suite and fresh review pending. No PR opened before local validation completion.
No second scheduler/ledger/control plane; no credentials/Risk/qualification change.
PAPER_ONLY;liveAuthority=NONE;productionMutationAllowed=false;
aiAuthority=ZERO_AUTHORITY. Genuine operating acceptance still UNVERIFIED.

Fresh Parfit review PASS after P2 paired-observation correction; independently28
tests PASS, source diff unchanged. Two-file diff SHA256
08e464252c83df517865928a54057bcd8aaa230be33f6d06cec8d0adf80318c4.
This test uses a stateful port, not actual SQLite producer reconstruction or
production restart. Do not promote its scope when describing recovery evidence.

Full pnpm test PASS1229 isolated test files, including corrected paired fixture.
Only generated tracked isolated-test-failure.txt deletion restored to baseline.
Local gates complete; exact-head CI and canonical Audit/Release remain pending.
