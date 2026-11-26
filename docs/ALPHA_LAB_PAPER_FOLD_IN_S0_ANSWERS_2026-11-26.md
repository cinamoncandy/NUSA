요약(한국어): 5개 질문 모두 코드로 확인. 리스 하트비트는 틱과 무관하게 저장소 내부 10초 타이머가 돌지만, 리스 상실 시 프로세스를 내리는 것은 틱뿐이다. COLLECT_ONLY는 리스 자체가 없다. 권한 불변식은 여러 곳에서 강제된다. Cloud AI는 주문 경로가 없다(단, SQLite에 자체 기록은 한다). 그림자 원장 스키마는 아래 PROPOSAL.

# S0 answers: closedLearningProductionRuntime.ts, before staged cleanup / fold-in

Basis: `origin/main` after `git fetch` (read via `git show`; no checkout, no repo edits). Line numbers are origin/main.
Abbreviations: CLPR = `apps/cloud/src/closedLearningProductionRuntime.ts`, RT = `apps/cloud/src/runtime.ts`, SRV = `apps/cloud/src/server.ts`, PTEL = `apps/cloud/src/paperTradingExecutionLoop.ts`.

## 1. Who keeps the PAPER writer lease alive and fails closed on loss?

Short answer: the lease heartbeat is NOT driven by the closed-learning tick. The tick is only one of several lease checkers, and it is the only one that turns a lost lease into a process shutdown.

Facts:
- Lease duration `PAPER_WRITER_LEASE_DURATION_MS = 120_000`, heartbeat 10 s, takeover age 210 s (PTEL:185-188; comment PTEL:176-184).
- The heartbeat is a timer inside the repository itself: `startWriterLease()` does `setInterval(() => this.heartbeatLease(), heartbeatIntervalMs)` with `unref` (PTEL:261-263). It does not depend on CLPR or on any closed-learning timer.
- `heartbeatLease()` (PTEL:680-686) calls `assertLeaseHeld()` (PTEL:688-707): conditional UPDATE `WHERE owner_id=? AND lease_until_ms > now`, plus clock regression/anomaly checks. On failure it sets `leaseLost=true` and stores `leaseFailure`. It swallows the error: the heartbeat timer itself never exits or stops the process. Once lost it stays lost (PTEL:689; test `paperTradingExecutionLoop.behaviour.test.ts:351-352`).
- Fail-closed consumers of that flag: every `save`, `loadLatest`, `loadHistory`, `loadFills`, `clear` call `assertLeaseHeld()` and throw `PAPER_WRITER_LEASE_LOST` (PTEL:271-278 for save, :319-321 for `verifyWriterLease`). Tests: `paperTradingExecutionLoop.behaviour.test.ts:293-352`.
- Callers of `verifyWriterLease()` in apps/cloud (non-test): only CLPR. (a) inside the tick, first line, CLPR:466; (b) four times between the synchronous startup phases, CLPR:561, 564, 567, 569; and internally in `startWriterLease()` PTEL:256/258/260. Nothing in RT calls it.
- Startup window: `createLeaseStartupWindow` (CLPR:184, `paperLeaseStartupWindow.ts`) only logs `OK/SLOW/LEASE_AT_RISK`; the file states it "never reads or changes the lease" (`paperLeaseStartupWindow.ts:1-5`). Lease start is deferred (`deferWriterLease: true`, CLPR:189) and runs inside `baseHandle.startPaperRuntime()` (CLPR:557 (`startPaperRuntime()` is called there; 556 is `prepareRecovery`) -> RT:536-545).
- Tick scheduling: `setTimeout(scheduleTick, 0)` + `setInterval(scheduleTick, CLOSED_LEARNING_ROLLOVER_POLL_INTERVAL_MS)`, only `if (orderPathEnabled)` (CLPR:581-587). A tick failure goes to `failClosedScheduler` (CLPR:538-547): logs, `recordRuntimeFailure("CLOSED_LEARNING_SCHEDULER")`, `process.exitCode = 1`, then `requestFatalShutdown()` or `handle.stop()`. `main()` wires that to `registerGracefulShutdown` (CLPR:603-625 region).
- The PAPER market-tick path also trips on lease loss, but softly: `repository.save` throws inside `PaperTradingExecutionLoop`, caught at PTEL:1068/1092/1160/1194 and returned as `FAILED "paper account persistence failed"`; RT:719-723 only calls `recordFailure(...)` (sets `lastError`, appended with the cause such as `PAPER_WRITER_LEASE_LOST`). No exit, no stop.

If the tick timers do not exist (what happens to lease loss):
- COLLECT_ONLY (`orderPathEnabled` false): no repository, no lease row, no heartbeat, no verify calls (CLPR:110-113, 185-187; RT:538 `paperRuntimeStarted=true; return`). Nothing to lose. Pinned by `tests/closed-learning-daemon-order-path-off.test.js` (verifyCalls 0, leaseStarts 0, no lease row) and `tests/production-entry-boot-modes.test.js` (`leaseRows === 0`).
- PAPER_ORDERS but tick removed (a hypothetical fold-in): the 10 s timer still renews and still sets `leaseLost`; the only consequences are (a) every PAPER save fails with FAILED + `lastError` on /health, (b) the process keeps running and no supervisor exit happens. The 4 inter-phase `verifyWriterLease` calls (CLPR:561-569) would also have to be kept, because the synchronous startup can exceed the lease before the event loop heartbeats (comments CLPR:182-183, 559-560, PTEL:255-256, `paperLeaseStartupWindow.ts:3`).
- Conclusion for fold-in: the tick's `verifyWriterLease()` (CLPR:466) is the ONLY path that converts lease loss into a fatal shutdown. Any cleanup that removes or reschedules the tick must either keep that call on an independent timer or accept soft-fail only. This is a design fact, not a defect claim.
- Not determinable from code: other entry points (e.g. `scripts/start-cloud-runtime.js`, RT:1036 `main`) were not traced for their own lease supervision.

## 2. Exact /health shape of a freshly booted COLLECT_ONLY node

Route: `GET /health` (SRV:857-870). Body is `{ ok: true, observedAt, capabilities: { passwordSignIn }, ...pipeline, ...runtimeHealth }` where `pipeline = observePipeline()` (SRV:1052-1058) spreads four keys, only when a liveness source is wired (it is, RT:~915 `runtimeLiveness`): `runtime`, `learningPipeline`, `learningPipelineAlarm`, `learningLoopVerdict`; `runtimeHealth` = `{process, workload}` from `projectPaperRuntimeHealth` (`paperRuntimeHealth.ts`; process PASS/DEGRADED on `lastError`).

`runtime` is the sanitised `publicRuntimeLiveness` (SRV:321-681). For COLLECT_ONLY:
- Always present (RT:918-950 liveness builder): `sourceCommitSha` only if full 40-hex (SRV:678), `runMode: "COLLECT_ONLY"` (RT:921, derived at RT:125-129 from `isPaperOrderPathEnabled`, RT:118-123), `orderPathReady: false` (RT:923: `effectivePaperLoop != null && productionPaperBoundary != null`), `startedAt`, `lastHeartbeatAt`, `lastMarketEventAt`, `lastPaperDecisionAt`/`OrderAt`/`FillAt` (null), `eventCount`, `decisionCount`, `paperOrderCount`, `paperFillCount` (0), `lastError`, optional `previousStop`, stall-monitor fields, `paperFunnel`.
- Conditionally present: `researchCollectionStatus` (+ `researchCandleCount`, `researchRequiredCandles`) is emitted when `researchLiveness()` returns one of COLLECTING/DISABLED/INVALID/UNAVAILABLE (RT:856-861; SRV:662-669); the pinned test config sets `NUSA_CLOUD_RESEARCH_EXPERIMENTS=0`, which yields `DISABLED`. Collector blocks (`microstructureRecorder`, `orderBookCollector`, `futuresCollector`, coverage watches, `dataIntegrity`, `researchRolling...`) appear only if their provider exists/has data.
- `paperLedger`: absent in COLLECT_ONLY because `effectivePaperLoop` is undefined (RT:839 returns `{}`).
- `closedLearningLoop`: `closedLearningLiveness()` (RT:851) returns it only when `loopStatus.snapshot()` is non-null (`closedLearningLoopStatus.ts:420`; initial `status = null`, line 120) AND the server sanitiser finds `bootstrap` and `rollover` strings (SRV:485-604). No tick runs in COLLECT_ONLY (CLPR:581), so on a fresh DB the key is ABSENT. Caveat: `seedLastBlocked` (CLPR:209; cls:396-402) calls `publish()` when a previous-process blocked record exists in the DB, so a non-fresh DB may show it. I did not trace `publish()` to confirm what it emits.
- `learningPipeline` and `learningLoopVerdict` are always computed from `runtime` (SRV:1057-1058). Their values for COLLECT_ONLY (labels such as UNKNOWN/BLOCKED, `firstBrokenTransition`) were NOT evaluated here; I read the types but did not execute the projectors. Cannot be determined without running them.

Tests that pin this:
- `tests/production-entry-boot-modes.test.js`: real daemon entry boots in a child process per mode; asserts `runMode === "COLLECT_ONLY"`, `leaseRows === 0`, `fills === 0`, `orders === 0`, and `ready === false` (orderPathReady) for unset/OFF/garbled/empty `NUSA_PAPER_ORDER_PATH` and for `NUSA_RUN_MODE` COLLECT_ONLY/STOPPED/garbled/empty and for `NUSA_REQUIRE_RUN_MODE=1` with missing mode. PAPER_ORDERS control: lease row exists.
- `tests/cloud-runtime-order-path-switch.test.js:108-111` (runMode values), `:114+` (pinned at startup, not re-read).
- `tests/health-watch.test.js:47-67` (host watcher's COLLECT_ONLY facts: `runMode`, `orderPathReady:false`, `paperOrderCount:0`, fresh `lastMarketEventAt`).
- The tests do NOT pin the full key set of /health; they pin only the keys listed above. A full-shape snapshot for COLLECT_ONLY does not exist as a test.

## 3. Where the authority invariants are enforced (cloud runtime)

No single central gate; the invariant is repeated at each boundary. Enforcing sites found (non-test):
- Order path closed by default: `isPaperOrderPathEnabled` fail-closed switch (RT:118-123); `startPaperRuntime` creates no loop/boundary otherwise (RT:538); test `production-entry-boot-modes`.
- PAPER-only execution input: `CloudPaperExecutionBoundary.submitManualOrder` requires `command.authority === "PAPER_ONLY"` and `productionMutationAllowed === false` or falls back to the plain simulator (`cloudPaperExecutionBoundary.ts:48`); `cioDecisionEngine.ts:104` rejects bindings with `liveAuthority !== "NONE"` or `productionMutationAllowed !== false`; `executionEngineV10.ts:32` rejects `riskDecision.productionMutationAllowed !== false`. RT:886-909 stamps `liveAuthority: "NONE", productionMutationAllowed: false` on every PAPER command result; SRV:281 logs `authority: "PAPER_ONLY"` on the paper_order route.
- Closed-learning artefacts (the files CLPR consumes): `closedLearningEvolutionLedgerRepository.ts:120`, `closedLearningLoopCoordinator.ts:136` (`authority === "PAPER_RESEARCH_ONLY"`, `liveAuthority "NONE"`, `productionMutationAllowed false`, `aiAuthority ZERO_AUTHORITY`), `closedLearningResearchDecisionHistory.ts:23-28, 81-82`, `closedLearningResearchWorkerClient.ts:170, 178, 246-249`, `candidatePromotionRuntime.ts:127`, `engineeringOperatingReadModel.ts:411`, `evolutionLearningSupervisorHttp.ts:22-23`.
- Contracts: `packages/contracts/src/evolutionLearningSupervisor.ts:27, 96` (type literal `"ZERO_AUTHORITY"` + runtime throw; test `evolutionLearningSupervisor.test.ts:35, 44`); contracts that carry `productionMutationAllowed`: `aiInference`, `aiInferenceResources`, `aiOutcomeAttribution`, `aiProviderDiversity`, `aiScenarioReasoning`, `aiExplanationFaithfulness`, `candidatePromotion`, `evidenceGraph`, `global-risk-gateway`, `liveReadinessObservability`, `multiAgentGovernance` (type-level literals; I did not verify each has a runtime validator).
- `realOrderAuthority=false`: `apps/cloud/src/ai/multiAgentOrchestrator.ts:60` (type literal), `multiAgentGovernance.ts:469` set, `:503` rejected if not false; AI runtime gate `ai/runtime.ts:218-223, 505, 528` (`zeroAuthority()` must hold or the result is not accepted); also `nVersionStrategyEvaluator.ts:388`, `outcomeAttributionEvaluation.ts:96`, `outcomeAttributionLearning.ts:355`, `scenarioCounterfactualEvaluator.ts:238`.
- Static guard: `scripts/validate-ai-zero-authority.js` scans `apps/cloud/src/ai`, `apps/desktop/src/ai`, `apps/autopilot/src` (lines 7-14) and fails on (a) imports/requires matching `paperBroker|runtimeCommandService|liveOrderAdapter|tradingAdapter|upbit.*order` (line 17), (b) calls to `PaperBroker|submitOrder|cancelOrder|replaceOrder|withdraw|activateLive|dialBroker(` (~line 140), (c) literals `productionMutationAllowed: true | realOrderAuthority: true | realTransferAuthority: true` and `liveAuthority: 'BOUNDED_LIVE'`, (d) any new `ai` directory outside the scan roots (meta-guard, lines 112-131), (e) missing `NUSA_AI_ENABLED` default-off in `ai/runtime.ts`. Test: `tests/ai-zero-authority-guard.test.js`. ADR: `.aipos/decisions/ADR-0004-ai-zero-authority-runtime.md`.
- Live authority dormant: `liveReadinessGate.ts:143` (BOUNDED_LIVE requires lease), RT default `createDormantLiveAuthority()` (RT near `defaultLiveReadinessReaders`).
- Gaps / not determinable: the guard does NOT scan `apps/cloud/src/*.ts` outside `ai/` (including CLPR itself), so CLPR's own invariants rest on runtime checks and tests, not on this validator. I found no single grep-able constant for `aiAuthority` in CLPR or RT other than via the artefact validators above.

## 4. Is the Cloud AI runtime (createCloudAiRuntime in CLPR) read-only?

Short answer: it cannot place or influence an order by any code path I found; it is not "read-only" in the storage sense.
- Built at CLPR:173 `createCloudAiRuntime(env, undefined, { verifiedSharedSqliteDatabase: database })` and handed to `startCloudRuntime` via `aiRuntime: cloudAiRuntime` (CLPR:229). It is built regardless of order-path mode and is default OFF (`enabled` only if `NUSA_AI_ENABLED === "true"`, `ai/runtime.ts:~290`; guard checks that string).
- Imports of `ai/runtime.ts` (lines 1-23): only contracts, AI modules, and two SQLite AI stores (`SqliteAiCalibrationDurableStore`, `SqliteAiOutcomeAttributionMemory`). No import of the PAPER loop, boundary, risk gateway, broker or Upbit order code. Interface (`ai/runtime.ts:86-100`) is `schedule(input): boolean` plus readers (`latest*`, `applicableLessons`, `calibrationProfile`...) and constants `liveAuthority: "NONE"`, `productionMutationAllowed: false` (end of file, ~662-665). No method returns an order or a size.
- Use in RT: the only call that feeds it is `aiRuntime?.schedule({... policyVersionIds ["AI_ZERO_AUTHORITY_POLICY_V1","NUSA_DETERMINISTIC_SAFETY_V1"], ...})` inside `try { } catch { /* advisory AI only */ }` (RT:681-685), placed BEFORE and separate from the PAPER tick (RT:686+). The PAPER `tick` object (RT:687) carries no AI field. The other consumer is `projectAiReadOnly(aiRuntime.latest(...))` for the display snapshot (RT:887).
- Indirect influence channel (soft): `applicableLessons(...)` output is fed back into the evidence of the NEXT AI prompt (RT:681-683) only; not into strategy/risk.
- Side effects that do exist: it writes to the shared SQLite DB (calibration durability store, attribution memory; CLPR:170-173 comment) and calls the model provider (network, cost) when enabled. A fold-in that moves the DB or the lease must keep that in mind. Results are accepted only when `zeroAuthority(result)` is true (`ai/runtime.ts:218`).
- Residual risk not excluded: I did not audit every transitive import of the AI modules for hidden mutation paths; the static guard (Q3) covers that for `apps/cloud/src/ai`, which is the evidence.

## 5. Existing PAPER period evidence store, and what a shadow-ledger row needs beyond it

Existing store (all PAPER-realised-period evidence, not per-decision):
- Types: `packages/contracts/src/persistedPaperPeriod.ts` (52 lines): `PersistedPaperPeriodRecord` { recordId, periodIndex, market?, advisory (LeagueCapitalAllocationAdvisory), periodStartAt, periodEndAt, `realizedReturns: Record<candidateId, number>`, benchmarkReturn, `turnoverCostRate`, `costEvidence: PaperPeriodCostEvidence` {evidenceId, source "PAPER_EXECUTION_RECEIPT", evidenceKind OBSERVED|CONSERVATIVE_MODEL, evidenceFingerprintSha256, observedAt, feeRate, spreadRate, slippageRate}, benchmarkEvidenceId?, benchmarkInputFingerprintSha256?, canonicalOutcomeReceiptFingerprint?, status COMPLETED|REJECTED|HALTED }; `PersistedPaperCandidateProvenance` { candidateId, datasetId, datasetContentSha256 }; `PersistedPaperPeriodEnvelope` { record, candidateProvenance[] }.
- Storage: `packages/storage/src/persistedPaperPeriodStore.ts` `SqlitePersistedPaperPeriodStore`; tables `research_paper_forward_periods` (UNIQUE period_index) and `research_paper_forward_period_pending` (lines 75-76, 229-250); `append`, `putPending`/`updatePending`/`finalizePending`/`retirePending`, `markPendingIneligible`, `list`, `listRecords`, `nextPeriodIndex`. It also has `prune(maximumPeriods, guard)` which DELETEs realised rows (line 318-330), so it is append-oriented but NOT strictly append-only.
- Writer: `apps/cloud/src/paperRealizedPeriodProducer.ts` (`PaperRealizedPeriodProducer`, :307; `openPeriod`, `observeExecution`, `closePeriodFromCanonicalAccount`, `disposeIncompletePeriodFromCanonicalAccount`), called from RT:699/904 (`observeExecution`) and CLPR (`periods`, ensure/rollover). Owner baseline period builder: `ownerBaselinePaperPeriod.ts`.
- Readers: CLPR `periods.listRealizedPeriods()` (meta-learning input CLPR:~490-500, rule-replay), `paperPerformanceFromLedger.ts`, `closedLearningEvidenceIdentitySource.ts`, `closedLearningLineageReplayInputSource.ts`, `closedLearningRolloverScheduler.ts`, `paperCanonicalOutcomeReconciliation.ts`, desktop `persistedPaperPeriodAdapter/Store`, `researchPaperEvidenceBridge.ts` (guarded by `tests/research-architecture-guard.test.js:32`).
- Companion per-fill evidence (finer than a period): `PaperFillRecord` (PTEL:131-159) in `cloud_paper_fill_ledger` carries `price`, `fee`, `filledAt`, `executionProfileFingerprintSha256`, `orderBookQuoteReceipt`, `orderBookExecutionReceipt`, `candidateProvenance` (CIO decision binding), `runtimeExecutionCostEvidence`, `executionCostAttribution`. It contains `orderId`, so it is an order record, not a shadow row.
- Gaps vs a decision/outcome shadow ledger: the period store is per period and aggregate (net return per candidate, one rate triple, one cost fingerprint); it has no per-decision time, side, intended size basis, entry/exit prices/times, hypothesis hash, cost-model version, outcome-label definition id, or gap flags. Per-fill rows exist but include order identifiers and only for PAPER fills, not for non-traded decisions.

### PROPOSAL (not implemented; no code change requested now): append-only shadow ledger row

```ts
/** PROPOSAL ONLY. One immutable row per decision/outcome pair. Append-only: no UPDATE/DELETE; corrections are new rows. */
interface ShadowLedgerRowV1 {
  readonly schemaVersion: 1;
  readonly rowId: string;                         // sha256 over the canonical content fields below ONLY (everything except sequence, prevRowSha256, writtenAtMs and rowId itself): content-addressed, the dedupe key; the chain is separate: rowSha256 = sha256(rowId || sequence || prevRowSha256 || writtenAtMs)
  readonly sequence: number;                      // monotonic per ledger; hash chain below
  readonly prevRowSha256: string | null;          // hash chain to the previous row

  // identity of what was tested
  readonly candidateId: string;
  readonly hypothesisHashSha256: string;          // hash of the pre-registered hypothesis/spec
  readonly datasetId: string;
  readonly datasetContentSha256: string;

  // the decision (point in time; no information after decisionAtMs)
  readonly decisionAtMs: number;
  readonly market: string;                        // e.g. "KRW-BTC"
  readonly hypotheticalSide: "BUY" | "SELL" | "NONE";          // NONE = signal evaluated, no position implied
  readonly intendedSizeBasis: { kind: "NOTIONAL_KRW" | "FRACTION_OF_EQUITY" | "UNIT_NOTIONAL"; value: number };

  // cost model (assumed, versioned; not observed fills)
  readonly costModelVersion: string;              // e.g. "cost-model-v3"
  readonly feeRatePerSide: number;
  readonly slippageRate: number;
  readonly spreadRate: number;
  readonly costEvidenceKind: "OBSERVED" | "CONSERVATIVE_MODEL";
  readonly costEvidenceFingerprintSha256: string | null;

  // hypothetical outcome (mark-to-market on stored bars/quotes only)
  readonly entryPrice: number | null;
  readonly entryAtMs: number | null;
  readonly exitPrice: number | null;
  readonly exitAtMs: number | null;
  readonly outcomeLabelDefinitionId: string;      // fixed id of the label definition (horizon, barrier rule)
  readonly grossReturn: number | null;
  readonly netReturn: number | null;              // after fee, slippage, spread; null while open/unlabelled
  readonly labelStatus: "OPEN" | "LABELLED" | "VOID";

  // data quality
  readonly gapFlags: readonly ("MISSING_BARS" | "STALE_QUOTE" | "FEED_DISCONNECT" | "BACKFILL_GAP" | "PRICE_OUTLIER")[];
  readonly inputFingerprintSha256: string;        // hash of the exact bars/quotes read

  // provenance
  readonly sourceCommitSha: string;               // 40-hex build commit
  readonly runId: string;
  readonly writtenAtMs: number;

  // fixed authority stamps (copied from the existing invariant vocabulary)
  readonly authority: "PAPER_RESEARCH_ONLY";
  readonly realOrderAuthority: false;             // as the AI contracts carry
  readonly realTransferAuthority: false;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
  // deliberately absent: orderId, clientOrderId, idempotencyKey, accountId, any broker or exchange identifier
}
```
Design notes for the proposal:
- Reuse, do not duplicate: cost fields mirror `PaperPeriodCostEvidence` (feeRate/spreadRate/slippageRate/evidenceKind/fingerprint) and candidate fields mirror `PersistedPaperCandidateProvenance`; add what the period store lacks (hypothesis hash, decision time, side, size basis, cost-model version, entry/exit, label id, gap flags, hash chain).
- `labelStatus: "OPEN"` with a null `netReturn` implies a later update, which contradicts append-only. **Precondition for S4:** a second, append-only row type (a `ShadowOutcomeRowV1` that references the decision row by `rowId`) replaces any update; the decision row is then immutable and `labelStatus` leaves it.
- "No information after `decisionAtMs`" is a rule, not something the schema enforces: S4 needs a test that every feature input carries an as-of time not after `decisionAtMs`.
- Append-only must be enforced by the store (no UPDATE/DELETE statements, UNIQUE rowId, chain check on read), and unlike `SqlitePersistedPaperPeriodStore.prune` it must have no retention delete.
- Not decided here: table location (canonical SQLite vs a separate file), whether OPEN rows are later closed by a second row type, and who writes it (a read-only tick consuming stored bars). Those are open design questions for the work order.

## Cannot be determined from code (summary)
- Values of `learningPipeline` / `learningLoopVerdict` on a fresh COLLECT_ONLY node (projectors not executed).
- Whether `ClosedLearningLoopStatusTracker.publish()` makes `closedLearningLoop` visible when only a stale `lastBlocked` record is seeded.
- Lease supervision in other entry points (`scripts/start-cloud-runtime.js`, RT:1036 `main`).
- Per-contract runtime validators for every contract that merely declares `productionMutationAllowed`.


## 8. Review corrections (independent review of 2026-11-26, applied)
- `startPaperRuntime()` is called at CLPR:557; CLPR:556 is `prepareRecovery`.
- The comments at CLPR:183 and CLPR:559 still say "30 s lease"; the code constants are 120 s lease, 10 s heartbeat, 210 s startup budget (PTEL:185-188). The answers above use the code values, not the comments.
- "Not strictly append-only" also applies to the `*_pending` table of the period evidence store, which has UPDATE and DELETE statements.
- Lease loss with orders enabled and no tick: every save fails and `lastError` is visible on `/health`, but nothing exits the process; "keeps running" means "keeps running without saving".
- The AST guard (`validate-ai-zero-authority.js`) has not been tried against `closedLearningProductionRuntime.ts`; a grep of that file for the forbidden patterns finds none, so it would pass today. Whether to make the guard cover it is a design question for S4, to be tried first, not assumed.
- What was run: the AIPOS yaml and drift validators. The S0 claims were read from code and not exercised by tests.
