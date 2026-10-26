# Learning-loop and Oracle timeout repair handoff — 2026-10-26

## Closed-learning status

- Protected main: `de6cb5d56acfec429659301c9c1ed8b424e7935f`.
- Read-only Oracle host diagnosis run `40275442510` completed successfully on that workflow ref. `/health` returned HTTP 200 at `2026-10-26T05:41:17Z`, but deployed runtime source is `c59b522410cb0ea62977382f15d253c331c690f8`, not protected main.
- Runtime reports `researchCollectionStatus=COLLECTING`, 45,108 candles / 15,840 required, `sessionsStarted=0`, and 110 `SKIPPED_DATASET_MANIFEST_MANIFEST_NOT_FOUND` entries. `closedLearningLoop` has 621 ticks, `cyclesEvaluated=0`, `cyclesRecorded=0`, `failuresRecorded=0`, bootstrap `RESEARCH_NOT_DEPLOYABLE`, `lastBlockedReason=TICK_ERROR`, and 68 owner-baseline realized periods. Since runtime start: 12,984 market events, no PAPER orders or fills. The 314 fills in the historical ledger predate this run and are not new outcome proof.
- `previousStop=PREVIOUS_CLOSED_LEARNING_SCHEDULER:PAPER_WRITER_LEASE_LOST`; 7.77-second maximum event-loop stall; services active with zero reported restarts. Disk is 90% used with 4.7 GB free; available memory was 377 MB. Full disk-consumer diagnostics were not run to avoid added I/O pressure.
- Orderbook study and data-integrity markers were unavailable from the health-only diagnostic. It did not authenticate `/ready` or verify writer-lease ownership/renewal. Exact-main runtime acceptance remains false; learning loop and performance improvement remain unverified.
- Existing genuine PAPER elapsed soak run `40270441841` is still in progress on exact main. Do not duplicate, cancel, or treat its in-progress state as acceptance.

## PR #2877 P1 repair

- PR #2877 latest verified checkpoint before this follow-up was `c98c5a1c072976cae36e74f25173f5636262bb23`, base/protected main `de6cb5d56acfec429659301c9c1ed8b424e7935f`; it remained Open/Draft.
- Fresh review on c98 found two P1s: a 240-minute outer backup job exactly matched 60 minutes of bounded preparation plus a 180-minute backup, leaving no orchestration/step-transition margin; and AIPOS still described predecessor cfbacd4f as current despite c98 checks having completed.
- This follow-up raises the isolated backup job to 260 minutes (60 preparation + 180 backup + 20 orchestration margin), preserves the 5/20/25/10-minute preparation caps and 180-minute backup cap, and updates regression coverage, runbook, active work order and state. New-head checks are pending until publication.
- Focused tests: 31/31 PASS with `C:\Program Files\Git\bin` added to PATH for Git Bash. Initial invocation failed only because Bash was absent from PATH. Workflow YAML parse PASS (`js-yaml`), `pnpm run validate` PASS, and `git diff --check` PASS. An ad-hoc parser check using undeclared `yaml` package failed; rerun with the repository's `js-yaml` succeeded. No full suite or host mutation performed.
- At c98 checkpoint, exact-head CI and required companions passed; the fresh review findings above are actionable and this follow-up has not yet been published. Keep PR #2877 Open/Draft; after publication resolve the current head dynamically, verify its exact-head checks and fresh review, and do not reuse c98 receipts as current-head evidence. Formal Validator, Independent Audit, Release and merge are separate gates.
- Do not dispatch Oracle release, install/update the host helper, restart services, or mutate DB/lease. #2770 remains open until governed exact-main runtime acceptance and authentic PAPER evidence are obtained.

Safety remains `PAPER_ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, `realOrderAuthority=false`, `realTransferAuthority=false`, `aiAuthority=ZERO_AUTHORITY`.
