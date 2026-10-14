# Learning failure recovery verification

Base: 2e05ab0543c8e77835721aa7780163cc6702c4b4.
Branch: codex/learning-crash-replay-20261015.
Continue WO-ISSUE-2589-CLOSED-LEARNING-FAILURE-EVIDENCE; no duplicate scheduler or ledger.

Added a test-only separate-process nonzero-exit regression. A child appends an
IDENTITY failure to a temporary SQLite database, exits 23 without db.close, and
three separate processes replay the same input. Parent verifies the identical
single receipt and zero fabricated cycles after each exit. This is not SIGKILL,
power-loss durability or actual production restart acceptance.

Build/typecheck/validate:full/aipos:index and 109 focused tests PASS.
lint:scripts PASS, 24 existing warnings. Fresh non-author review has no P0/P1/P2
findings; pre-Audit PASS_WITH_NOTES only. Security gate PASS, no unmitigated
high/critical findings and no secrets. Exact-head CI/Audit/Release pending.
Historical work-orders:index:check does not exist; actual aipos:index -- --check
was executed successfully and the work-order command corrected.
No runtime behavior or policy change.
Actual diagnostic 38655054992 confirms generic blocked status across restart,
not period-bound failure-receipt acceptance. No qualified candidate or complete
cycle observed; #1605/#2589 remain OPEN and VERIFIED=false.

PAPER_ONLY; liveAuthority=NONE; productionMutationAllowed=false;
aiAuthority=ZERO_AUTHORITY. No production failure injection or Risk relaxation.
