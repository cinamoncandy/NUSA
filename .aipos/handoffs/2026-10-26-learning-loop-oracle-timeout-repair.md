# Learning-loop and Oracle timeout repair handoff — 2026-10-26

## Closed-learning status

- Protected main: `de6cb5d56acfec429659301c9c1ed8b424e7935f`.
- Read-only Oracle host diagnosis run `40275442510` completed successfully on that workflow ref. `/health` returned HTTP 200 at `2026-10-26T05:41:17Z`, but deployed runtime source is `c59b522410cb0ea62977382f15d253c331c690f8`, not protected main.
- Runtime reports `researchCollectionStatus=COLLECTING`, 45,108 candles / 15,840 required, `sessionsStarted=0`, and 110 `SKIPPED_DATASET_MANIFEST_MANIFEST_NOT_FOUND` entries. `closedLearningLoop` has 621 ticks, `cyclesEvaluated=0`, `cyclesRecorded=0`, `failuresRecorded=0`, bootstrap `RESEARCH_NOT_DEPLOYABLE`, `lastBlockedReason=TICK_ERROR`, and 68 owner-baseline realized periods. Since runtime start: 12,984 market events, no PAPER orders or fills. The 314 fills in the historical ledger predate this run and are not new outcome proof.
- `previousStop=PREVIOUS_CLOSED_LEARNING_SCHEDULER:PAPER_WRITER_LEASE_LOST`; 7.77-second maximum event-loop stall; services active with zero reported restarts. Disk is 90% used with 4.7 GB free; available memory was 377 MB. Full disk-consumer diagnostics were not run to avoid added I/O pressure.
- Orderbook study and data-integrity markers were unavailable from the health-only diagnostic. It did not authenticate `/ready` or verify writer-lease ownership/renewal. Exact-main runtime acceptance remains false; learning loop and performance improvement remain unverified.
- Existing genuine PAPER elapsed soak run `40270441841` is still in progress on exact main. Do not duplicate, cancel, or treat its in-progress state as acceptance.

## Current exact gate — PR #2877 / Issue #2770

- Protected main and PR base: `de6cb5d56acfec429659301c9c1ed8b424e7935f`.
- Published PR #2877: OPEN / Draft / mergeable, head `ea4ee46bc475b3610ec6a711115fdd1300c22012`.
- Exact-head CI `40286984490` and five required companion workflows `40286984464`, `40286984537`, `40286984564`, `40286984511`, `40286984487` passed.
- Fresh non-author Codex review completed on this exact head and found P1 #4375026300: PAM-backed `runuser` may move the backup process from the verified transient I/O-capped cgroup into a user session scope.
- Local successor repair now uses util-linux `setpriv` with resolved UID/GID and supplementary groups (no PAM), and checks `io.max` again after privilege drop immediately before Node. Regression coverage and runbook were updated. Local successor validation passes: focused tests 31/31, Node 24.19 preflight, validate:full, security:gate, lint (0 errors; existing warnings), bash -n, and diff check. It is not yet published and has no successor CI/review; do not reuse predecessor receipts.
- Exact-head Formal Validator, Audit, Release authorization, merge, and Oracle runtime acceptance remain pending. Keep Draft.
- Backup cancellation in run `40198892768` remains UNKNOWN; observed timing is only consistent with outer-budget pressure.

## Fresh read-only Oracle and learning status

At 2026-10-26 07:52 UTC: `nusa.service` active; local `/health` healthy; runtime SHA `c59b522410cb0ea62977382f15d253c331c690f8` does not match protected main. Root disk 90% used (4.7 GB free), available memory 395 MB. No deploy, restart, backup retry, DB mutation, or lease reset was performed.

Runtime reports `previousStop=PAPER_WRITER_LEASE_LOST`, 68 owner-baseline realized periods, 0 Research sessions, 150 manifest-not-found skips, 0 evaluated/recorded learning cycles, and no new PAPER orders/fills since process start. Historic ledger fills are not new candidate-bound proof. Authenticated readiness and writer-lease renewal were not verified. Dataset, Research N+1, durable learning, N+1 PAPER, and performance improvement remain unverified. Keep cancellation root cause UNKNOWN and `PERFORMANCE_IMPROVEMENT=UNPROVEN`.

Safety remains `PAPER_ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, `realOrderAuthority=false`, `realTransferAuthority=false`, `aiAuthority=ZERO_AUTHORITY`.
