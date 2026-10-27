# Handoff — PAPER writer lease liveness after #2744

- **Issue:** #2770
- **Branch:** `fix/p0-paper-lease-liveness-2770`
- **Base protected main:** `ee7033740dbf8bc0fb95454413d28de6ee771c2f`
- **Exact implementation head:** do not self-record here; fetch the PR head immediately before validation.
- **Authority:** `PAPER_ONLY / liveAuthority=NONE / productionMutationAllowed=false / aiAuthority=ZERO_AUTHORITY`
- This handoff grants no review, Audit, Release, merge, LIVE, or production-mutation authority.

## 1. Production-sized reproduction

Using the Oracle host's read-only daily backup copied to `/tmp` (274,280,448 bytes), with a separate local port and public market feed disabled, the pre-fix `8eff53fc` runtime reproduced the incident without exchange traffic:

- full isolated startup elapsed about **132.6 s**;
- listener log eventually appeared;
- the first closed-learning scheduler tick then failed closed with `PAPER_WRITER_LEASE_LOST`;
- the process shut down through the existing fatal path.

No production DB row was edited for this reproduction. The copied DB's abandoned writer lease was removed only in the disposable `/tmp` copy to reproduce the already-existing one-shot release recovery path.

## 2. Phase measurements

On the same production-sized copied database:

- canonical `SqliteDatabase` open + migrations + startup `PRAGMA quick_check`: **28–34 s** across measurements;
- `SqliteCloudPaperAccountRepository` constructor after recovered lease: **~634 ms**;
- `PaperTradingExecutionLoop` restore (`loadLatest`): **~198 ms**;
- `SqliteAiCalibrationDurableStore` open: **~116.0 s**;
- `SqliteAiOutcomeAttributionMemory` open: **~125.9 s**.

The PAPER repository therefore is not the remaining startup bottleneck fixed by #2744. The liveness break is caused by other synchronous full-file integrity work occurring after the renewable PAPER lease is acquired.

A second independent runtime hazard exists in `CloudPaperCanonicalRiskGateway.evaluate()`: it repeats `PRAGMA quick_check` on every risk evaluation. On this database a full-file quick check is lease-scale or larger, so a single PAPER risk evaluation can block the Node event loop long enough to starve the 30 s writer heartbeat.

## 3. Minimal fix

This branch changes only two runtime behaviours:

1. Create the existing Cloud AI runtime **before** constructing `SqliteCloudPaperAccountRepository`, so AI durability's existing fail-closed SQLite verification completes before the renewable PAPER writer lease is owned. AI durability semantics are unchanged; only composition order changes.
2. Replace per-risk-evaluation full-file `PRAGMA quick_check` with an O(1) `SELECT 1` connection probe plus the existing required Risk-table presence checks. The canonical `SqliteDatabase` constructor still performs full-file `PRAGMA quick_check` at database open, and individual persistence operations still fail closed on SQLite errors.

No lease TTL, takeover age, Risk threshold, order authority, capital, qualification threshold, migration, scheduler authority, or fail-closed error is weakened.

## 4. Regression evidence added

- `tests/paper-writer-lease-liveness.test.js`
  - locks AI durability initialization before writer-lease acquisition;
  - locks full quick-check to canonical DB startup rather than the Risk hot path.
- `apps/cloud/src/cloudPaperCanonicalRiskGateway.liveness.test.ts`
  - instruments the real SQLite connection and proves one risk evaluation executes no `PRAGMA quick_check` while still probing connection/table availability.
- exact-source Risk requalification blob is intentionally advanced with the reviewed source change.

## 5. Acceptance chain

Implementation completion is not runtime acceptance. Required chain remains:

`exact-head CI -> fresh non-author VALIDATOR -> Independent Audit -> Release authorization -> protected-main merge -> non-cancelled exact-main Oracle deploy -> authenticated /ready -> stable 41731 listener through scheduler start -> natural restart/replay -> no duplicate fills/history/cycles`

The separate external Oracle workflow cancellation loop remains an independent blocker until a release reaches a natural terminal result.

Until that chain is complete: `VERIFIED=false`, `PERFORMANCE_IMPROVEMENT=UNPROVEN`, `AUTOPILOT_VERIFIED_COMPLETION_LOOP=false`.
