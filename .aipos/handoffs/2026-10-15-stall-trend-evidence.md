# Event-loop stall trend after deploy 4263bcd45 (health_only readings)

Runtime started 02:46:46Z. Readings (no diagnostic I/O in the health_only run):
- 03:06:14Z (20 min up, a du walk ran 02:54-02:55 and just before this read): eventLoopStallCount 462, max 28125 ms, /health 1.9 s.
- 03:35:53Z (49 min up, run 38677076205 health_only): eventLoopStallCount 492, max 28125 ms (unchanged), last stall 03:24:16Z, /health 0.34 s.
So +30 stalls in 29.5 minutes (about 1 per minute) after 462 in the first 20 minutes (about 23 per minute): the burst is a startup effect
(collector initial rounds, research service, diagnostic I/O), not a progressive regression. Not proven which of those; the earlier 10 stalls
(max 20 s) were measured 16 minutes after the previous deploy.
Collectors: orderBookCollector failures 9 of 42 rounds; futuresCollector rounds 47, marksStored 90, fundingStored 200, klinesStored 198,
failures 4, rejected 0. dataIntegrity still the 00:17Z WARN (next probe 2026-10-16 00:15Z). Memory 591 MB used, swap in use, / 91%.
PAPER: 2954 decisions, 482 BUY decisions rejected by CONSECUTIVE_LOSS_LIMIT (3 of 3, limit unchanged, resets at the KST day boundary),
0 orders, 0 fills. Learning loop unchanged: ticks 95, cyclesEvaluated 0, deployments 0, holdoutPasses 0, failuresRecorded 0. VERIFIED=false.
Next: second health_only reading about 10 minutes later and one full diagnosis for the disk-consumer annotation (scheduled).
PAPER_ONLY; liveAuthority=NONE; productionMutationAllowed=false; aiAuthority=ZERO_AUTHORITY.
