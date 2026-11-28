# Release-control rehearsal evidence (Cloudflare removal S3b), 2026-11-28

Status: **EVIDENCE (read-only run).** Workflow `release-control-rehearsal.yml`, dispatched once from main after #3289 and its fix #3356 merged: run 46138334043 (2026-11-28 11:07 UTC, 20:07 KST), result **`RELEASE_CONTROL_REHEARSAL_RESULT PASS cases=32`**.

- The first dispatch (run 46122168919) stopped before any case because the step ran under `bash -e` and case 1's expected failed read ended it; that run produced no case line and is not counted. Fixed by #3356.
- Case 1 read a missing path on the real API with HTTP 404 (ok=true). Every refusal case blocked with its code (global freeze, hold active in any spelling, non-object or unreadable file, each safety fact mismatch, hold between reads, hold on base, base or identity mismatch, stale or unknown base, clear-after-block, worker disagreement); both controls (clear, worker unreachable) cleared.
- The run published no status, minted no token, merged nothing and used no secret.
- S3b itself (switching the audit to this gate) stays an owner-by-hand merge.
PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`.
