# Deploy 4263bcd45 runtime evidence (diagnosis 38674413733, 2026-10-15 03:06Z)

Release 4263bcd45 (merged #2721 futures collector, #2723 tick error class, #2724 disk listing, #2722 fatal shutdown) deployed by
oracle-paper-release 38671439162 (success); /health.sourceCommitSha = 4263bcd45 = the released main then. #2720 (RAIM VenueSpec,
simulator, host study) merged afterwards and is NOT deployed yet; the RAIM study has not run (NOT RUN, window ends 2026-10-29).

Verified on the PAPER host:
- futuresCollector rounds 18, marksStored 36, fundingStored 200, klinesStored 198, failures 0, rejected 0: Binance public data
  reachable from the host and stored (B0 only proved a hosted runner). Research-only; feeds nothing.
- lastErrorClass absent: no TICK_ERROR in this process (lastBlockedReason TICK_ERROR at 02:37:54Z predates the 02:46:46Z start and is
  the persisted record). The class can only be read after the next occurrence.
- closedLearningLoop unchanged: ticks 38, cyclesEvaluated 0, deployments 0, bootstrap RESEARCH_NOT_DEPLOYABLE, holdoutPasses 0,
  failuresRecorded 0. VERIFIED=false.
- PAPER: 733 decisions, 453 BUY decisions rejected by CONSECUTIVE_LOSS_LIMIT (3 of 3, limit unchanged), 0 orders, 0 fills.
- orderBookCollector failures 2 of 16 rounds (rejected 0); dataIntegrity still the 00:17Z WARN (next probe 2026-10-16 00:15Z).

FIRST_BROKEN_TRANSITION candidate (not proven): event-loop stalls. This process: eventLoopStallCount 462, max 28125 ms, previousStop
PREVIOUS_STARTUP:PAPER_WRITER_CLOCK_ANOMALY, 20 minutes after start; the runtime before this deploy showed 10 stalls, max 20250 ms.
The first diagnosis after deploy (38673436344, 02:54Z) got /health timeout (6 s) right after the 40 s du walk; the next (38674413733)
answered in 1.9 s (vs 0.8 s before). Host is 1 vCPU, 954 MB, swap 555 MB used, / at 91% (4.5G free). Candidates: diagnostic I/O (du),
memory pressure, the new collector, research service. No restart, redeploy or config change was made. Next: compare the stall count
across two reads with no diagnostic I/O in between (needs a health-only diagnosis mode; #2725 moves the du walk last).

Disk: du listing reached only /var 1.1G and /opt/actions-runner-nusa-codex-2 873M before its 40 s limit (du_exit=124); releases ~11G
excluded by design; the remaining ~25G is unidentified.

PAPER_ONLY; liveAuthority=NONE; productionMutationAllowed=false; aiAuthority=ZERO_AUTHORITY.
