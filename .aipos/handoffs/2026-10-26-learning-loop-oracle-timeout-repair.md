# Learning-loop and Oracle timeout repair handoff — 2026-10-26

## Current canonical gate — PR #2877 / Issue #2770

- Protected `main` and PR base: `de6cb5d56acfec429659301c9c1ed8b424e7935f`.
- PR #2877: OPEN / Draft / mergeable; branch `ccr-00277777-hhlnx4`. The last verified source head before this AIPOS recovery correction was `2cbe7d282600df898e8f3057611c0324477fb753`; resolve the actual remote head afresh after publication.
- On predecessor source head `2cbe7d2`, workflows were SUCCESS: CI `40290233557`; Actual PAPER `40290233541`; Capability Guard `40290233558`; Activation Rehearsal `40290233634`; Transport Readiness `40290233595`; Read-only Broker `40290233733`. These receipts are historical for the AIPOS correction successor.
- Fresh Codex review receipt `6411381571` reviewed predecessor `2cbe7d2826` and said “Didn't find any major issues.” It is historical for the successor, does not provide formal P0/P1/P2 counts, and does not substitute for the NUSA Formal Validator.
- Fresh Codex review on successor `bb35bd1601491d7e28f3c1a3765e96f1137436db` found P2 `#4375925750`: a historical checkpoint `next` pointer referenced the superseded active entry. This successor points it to `current_ops_oracle_backup_current_head_20261026`; all `bb35bd1` receipts are historical for the new head.
- GitHub currently lists six unresolved inline review threads, all marked outdated: `4374437884`, `4374437889`, `4374692949`, `4374796244`, `4374887312`, and `4375026300`. Their comments refer to predecessor heads; do not self-resolve them. The separate Formal Validator must adjudicate current applicability and provide explicit counts/verdict.
- Formal NUSA Validator: PENDING. Independent Audit: NOT STARTED. Release authorization: NOT AUTHORIZED. Merge: NOT DONE. Keep Draft.
- Backup-cancellation initiator/root cause for run `40198892768` remains UNKNOWN. Timing is consistent with outer-budget pressure but does not prove it.

The active work order is `WO-OPS-20261025-ORACLE-BACKUP-IO-THROTTLE`. Its implementation repair is published in `2cbe7d2`; this follow-up changes AIPOS recovery records because they still directed operators to publish that already-published repair. The follow-up creates a new PR head, so resolve it from GitHub and rerun exact-head validation/review. The implementation replaces PAM-backed `runuser` with non-PAM `setpriv`, verifies the same device's transient-scope `io.max` after privilege drop immediately before SQLite, and fails closed if the cap is missing or mismatched. The 260-minute backup job (60-minute bounded preparation + 180-minute backup step + 20-minute transition margin), separate 40-minute release mutation job, 300-second readiness, 180-second soak, backup integrity/checksum/retention, and writer-lease semantics remain as reviewed. Actual host enforcement and throughput remain unverified until a governed post-merge exact-main release.

## Fresh read-only Oracle and learning observation

At `2026-10-26T09:11Z`, `/health` reported healthy, `nusa.service` was active, and port `41731` was listening. Runtime source SHA was `c59b522410cb0ea62977382f15d253c331c690f8`, not protected main. Root disk was 90% used with 4,864,728 KiB available. No deployment, restart, backup retry, database mutation, or lease mutation was performed. Authenticated `/ready` and current writer-lease ownership/renewal were not verified.

Health reported 45,108 research candles / 15,840 required, `sessionsStarted=0`, and 180 `SKIPPED_DATASET_MANIFEST_MANIFEST_NOT_FOUND` skips. Closed learning reported 68 realized owner-baseline periods, `cyclesEvaluated=0`, `cyclesRecorded=0`, `failuresRecorded=0`, bootstrap `RESEARCH_NOT_DEPLOYABLE`, and `lastBlockedReason=TICK_ERROR`. Its initiating error remains UNKNOWN. Historical ledger fills (314) are not new candidate-bound PAPER evidence. Sealed dataset, Research session, durable cycle, N+1, exact-main runtime acceptance, and performance improvement remain unverified.

Migration 032 and the archive retention change are present in protected-main ancestry through merged PR #2854, but the current Oracle runtime SHA predates `main`; runtime migration application and forward recovery are therefore not accepted as verified. No retention adjustment, archive deletion, synthetic candle, or history rewrite is permitted.

## Next permitted transition

Fresh-read the actual PR #2877 head and protected main → exact-head CI and one fresh non-author review for the AIPOS correction successor → separate Formal NUSA Validator receipt with `P0`, `P1`, `P2`, actionable findings, and explicit verdict. Do not proceed to Audit, Release, merge, or Oracle mutation without the exact-head accepted gate and subsequent governed approvals.

After governed merge, re-verify protected-main SHA, then use only the canonical Oracle release path. Exact-main runtime acceptance requires exact SHA, authenticated readiness, owned/renewing writer lease, stable listener, bounded startup and 180-second soak, controlled restart/replay, and duplicate-free behavior. Only then continue to sealed canonical dataset → authentic Research session → qualification/governed PAPER → candidate-bound outcome → durable learning cycle → Research N+1.

Safety remains `PAPER_ONLY`; `liveAuthority=NONE`; `productionMutationAllowed=false`; `realOrderAuthority=false`; `realTransferAuthority=false`; `aiAuthority=ZERO_AUTHORITY`. `LEARNING_LOOP_VERIFIED=false`; `PERFORMANCE_IMPROVEMENT=UNPROVEN`.
