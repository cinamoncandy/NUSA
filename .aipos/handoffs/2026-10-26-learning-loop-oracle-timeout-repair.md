# Learning-loop and Oracle timeout repair handoff — 2026-10-26

## Closed-learning status

- Protected main: `de6cb5d56acfec429659301c9c1ed8b424e7935f`.
- Read-only Oracle host diagnosis run `40275442510` completed successfully on that workflow ref. `/health` returned HTTP 200 at `2026-10-26T05:41:17Z`, but deployed runtime source is `c59b522410cb0ea62977382f15d253c331c690f8`, not protected main.
- Runtime reports `researchCollectionStatus=COLLECTING`, 45,108 candles / 15,840 required, `sessionsStarted=0`, and 110 `SKIPPED_DATASET_MANIFEST_MANIFEST_NOT_FOUND` entries. `closedLearningLoop` has 621 ticks, `cyclesEvaluated=0`, `cyclesRecorded=0`, `failuresRecorded=0`, bootstrap `RESEARCH_NOT_DEPLOYABLE`, `lastBlockedReason=TICK_ERROR`, and 68 owner-baseline realized periods. Since runtime start: 12,984 market events, no PAPER orders or fills. The 314 fills in the historical ledger predate this run and are not new outcome proof.
- `previousStop=PREVIOUS_CLOSED_LEARNING_SCHEDULER:PAPER_WRITER_LEASE_LOST`; 7.77-second maximum event-loop stall; services active with zero reported restarts. Disk is 90% used with 4.7 GB free; available memory was 377 MB. Full disk-consumer diagnostics were not run to avoid added I/O pressure.
- Orderbook study and data-integrity markers were unavailable from the health-only diagnostic. It did not authenticate `/ready` or verify writer-lease ownership/renewal. Exact-main runtime acceptance remains false; learning loop and performance improvement remain unverified.
- Existing genuine PAPER elapsed soak run `40270441841` is still in progress on exact main. Do not duplicate, cancel, or treat its in-progress state as acceptance.

## PR #2877 P1 repair

- PR #2877 was open/Draft, head `ef26d009bbebc33ad6ce14310ce6fd0c841d7e96`, base/protected main `de6cb5d56acfec429659301c9c1ed8b424e7935f`.
- Review finding: 240-minute backup job claimed 60 minutes of preparation, but source recheck, prune, exact-source helper proof download and helper identity proof had no step-level timeouts.
- Local repair applies 5/20/25/10-minute limits respectively (60 total), keeps the isolated backup step at 180 minutes, outer job at 240 minutes, and release job at 40 minutes. Regression checks enumerate all pre-backup steps, require each timeout and sum them against the 60-minute allowance. Runbook and active work order now state the enforceable limits.
- Focused tests: 31/31 PASS with `C:\Program Files\Git\bin` added to PATH for Git Bash. Initial invocation failed only because Bash was absent from PATH. Workflow YAML parse PASS (`js-yaml`), `pnpm run validate` PASS, and `git diff --check` PASS. An ad-hoc parser check using undeclared `yaml` package failed; rerun with the repository's `js-yaml` succeeded. No full suite or host mutation performed.
- Repair commit `81f9b98c86163e0047e66788a3b94a6c502ea13d` and AIPOS reconciliation commit `cfbacd4f82eee62bfb1de0c56b7fe16f839ce601` are published non-force to existing branch `ccr-00277777-hhlnx4`. Current PR head/base are `cfbacd4f82eee62bfb1de0c56b7fe16f839ce601` / `de6cb5d56acfec429659301c9c1ed8b424e7935f`; PR remains Open/Draft. Exact-head checks are still running, and the only review receipts observed target `ef26d009`, so they are historical. Wait for exact-head checks, then obtain a new-session `/grill-me` review; keep Draft. Formal Validator, Independent Audit, Release and merge are separate gates.
- Do not dispatch Oracle release, install/update the host helper, restart services, or mutate DB/lease. #2770 remains open until governed exact-main runtime acceptance and authentic PAPER evidence are obtained.

Safety remains `PAPER_ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, `realOrderAuthority=false`, `realTransferAuthority=false`, `aiAuthority=ZERO_AUTHORITY`.
