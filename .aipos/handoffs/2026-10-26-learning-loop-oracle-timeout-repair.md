# Learning-loop and Oracle timeout repair handoff — 2026-10-26

## Closed-learning status

- Protected main: `de6cb5d56acfec429659301c9c1ed8b424e7935f`.
- Read-only Oracle host diagnosis run `40275442510` completed successfully on that workflow ref. `/health` returned HTTP 200 at `2026-10-26T05:41:17Z`, but deployed runtime source is `c59b522410cb0ea62977382f15d253c331c690f8`, not protected main.
- Runtime reports `researchCollectionStatus=COLLECTING`, 45,108 candles / 15,840 required, `sessionsStarted=0`, and 110 `SKIPPED_DATASET_MANIFEST_MANIFEST_NOT_FOUND` entries. `closedLearningLoop` has 621 ticks, `cyclesEvaluated=0`, `cyclesRecorded=0`, `failuresRecorded=0`, bootstrap `RESEARCH_NOT_DEPLOYABLE`, `lastBlockedReason=TICK_ERROR`, and 68 owner-baseline realized periods. Since runtime start: 12,984 market events, no PAPER orders or fills. The 314 fills in the historical ledger predate this run and are not new outcome proof.
- `previousStop=PREVIOUS_CLOSED_LEARNING_SCHEDULER:PAPER_WRITER_LEASE_LOST`; 7.77-second maximum event-loop stall; services active with zero reported restarts. Disk is 90% used with 4.7 GB free; available memory was 377 MB. Full disk-consumer diagnostics were not run to avoid added I/O pressure.
- Orderbook study and data-integrity markers were unavailable from the health-only diagnostic. It did not authenticate `/ready` or verify writer-lease ownership/renewal. Exact-main runtime acceptance remains false; learning loop and performance improvement remain unverified.
- Existing genuine PAPER elapsed soak run `40270441841` is still in progress on exact main. Do not duplicate, cancel, or treat its in-progress state as acceptance.

## PR #2877 current repair

- PR #2877 was Open/Draft at reviewed head `1df5305bece93e39a28dbd641bb77bf05ac9561b`, base/protected main `de6cb5d56acfec429659301c9c1ed8b424e7935f`; verify live before publication.
- Required exact-head workflows passed on 1df. Fresh review found one P2: a predecessor AIPOS state entry still represented the 240-minute outer budget as current, while the reviewed code and work order use 260 minutes.
- Local AIPOS reconciliation now records 260 minutes (60 preparation + 180 backup + 20 orchestration), marks predecessor 240-minute entries as historical/superseded, and records the P2 plus pending successor validation. Focused Oracle tests 31/31 and `pnpm run preflight` now pass; `pnpm run validate` and `git diff --check` passed; publication and successor exact-head checks remain pending.
- Next: run focused tests, AIPOS validation, and `git diff --check`; recheck PR/base and publish only non-force if remote remains at 1df; then verify all successor exact-head workflows and fresh review. Keep Draft.
- Formal Validator, Independent Audit, Release, merge, and separately authorized Oracle host acceptance remain distinct later gates.
- Do not dispatch Oracle release, install/update the host helper, restart services, or mutate DB/lease. #2770 remains open until governed exact-main runtime acceptance and authentic PAPER evidence are obtained.

Safety remains `PAPER_ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, `realOrderAuthority=false`, `realTransferAuthority=false`, `aiAuthority=ZERO_AUTHORITY`.
