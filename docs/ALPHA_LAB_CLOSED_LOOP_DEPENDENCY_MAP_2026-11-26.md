# Alpha Lab pivot: dependency map of closedLearningProductionRuntime.ts

한국어 요약: 이 파일은 "학습 루프만 쓰는 부품(A)"과 "PAPER/연구/거버넌스와 같이 쓰는 부품(B/C/D)"을 나눈 지도입니다. 코드는 바꾸지 않았고, 삭제 제안도 없습니다. 루프를 끄면 /health 판정은 BLOCKED/UNKNOWN 쪽으로 닫히지만, 아래 4장의 위험(조용히 약해질 수 있는 게이트)을 먼저 보세요.

Scope and method
- Read-only. Source: `git show origin/main:<path>` after `git fetch origin main` (no checkout). Line numbers are of origin/main `apps/cloud/src/closedLearningProductionRuntime.ts` (629 lines; "L123" = that file) unless a path is given.
- "Importers" come from `git grep` of import/require strings in apps, scripts, packages (non-test) and tests. A regex over import specifiers can miss multi-line or dynamic imports; "(none)" means no other non-test importer was found, not proof. Test lists are from grep of module names, not from running tests.
- Nothing was run (no build, no tests). Nothing was executed against a live host.

## 0. What the file is (read from code)
- 629 lines, 60 import statements (L1-L59), 3 exports, one private helper `startupMark` (L66-71), one `main()` guarded by `require.main === module` (L610-629).
- It is the single composition root of the production daemon: it owns SQLite, the PAPER account repository and the deferred writer lease, builds the cloud runtime through `startCloudRuntimeFromOptions` (L220-236), then adds the closed-learning loop, shadows, research collectors and a 30 s scheduler (L582-587).
- The loop is NOT a separate module graph: it is interleaved with PAPER startup order (lease, recovery, research start; L555-576). Several "loop" pieces are really used for PAPER or /health, see section 4.

## 1. Exports and production consumers

### 1a. Exported symbols (L73, L75, L105)
| Symbol | Kind | Notes |
|---|---|---|
| `CLOSED_LEARNING_ROLLOVER_POLL_INTERVAL_MS` (=30_000) | const | used at L585 |
| `ClosedLearningProductionComposition` | interface (L75-95) | handle, challengerBindings, readCanonicalPaperAccount, runClosedLearningCycle(+Async), runClosedLearningBootstrap(+Async), runClosedLearningRollover(+Async), readPaperPerformanceEvidence |
| `startClosedLearningProductionRuntime(env, requestFatalShutdown?)` | function | returns composition. Quirk: the returned object (L589-601) also contains `evaluatePaperGovernanceFeedback`, which is NOT in the interface (L75-95). Not determined whether any caller depends on it (grep found no non-test caller of the name outside this file; I did not grep tests for it). |
`main()` is not exported; it runs only as the process entry (`require.main === module`, L629).

### 1b. Production entries (who runs / references it)
| Entry | How it uses it | Evidence |
|---|---|---|
| `scripts/start-cloud-runtime.js` | const `PRODUCTION_RUNTIME_ENTRYPOINT = "dist/apps/cloud/src/closedLearningProductionRuntime.js"`; supervises it as a child process (no `require`) | start-cloud-runtime.js:34 |
| `scripts/start-cloud-paper-supervisor.js` | default `runtimePath` = same compiled file; spawns it with `--require sqliteIntegrityBootstrap` | start-cloud-paper-supervisor.js:73 |
| `scripts/report-cloud-reachability.js` | `hostEntries` = this file + runtime.ts + files referenced from scripts/deploy/.github; this file is a root of the reachability graph (so "dead code" reports start here) | report-cloud-reachability.js:55 |
| `scripts/validate-repository-truth.js` | pins the compiled path and lists the .ts in a required-file list | validate-repository-truth.js:6,10 |
| `scripts/measure-startup-phases.js`, `scripts/measure-repo-facts.js` | comment/regex references only (phase order mirrors L105+; repo-facts regex counts tests mentioning `startClosedLearni...`) | :13,:51 / :57 |
| `.github/workflows/oracle-paper-release.yml:103` | release smoke `require("./dist/apps/cloud/src/closedLearningProductionRuntime.js")` (loaded, not started; `main()` is guarded) | line truncated in my grep; only the require is confirmed |
| `deploy/cloud-paper/README.md:95` | documents `nusa.service -> start-cloud-runtime.js -> closedLearningProductionRuntime.js` | |

### 1c. Tests that boot or pin it (boot modes and wiring)
| Test | What it does with it |
|---|---|
| `tests/production-entry-boot-modes.test.js` | spawns the REAL compiled entry per mode, calls `startClosedLearningProductionRuntime`, asserts runMode, lease rows, fills in SQLite (L24-27). The only boot-mode proof of lease absence in COLLECT_ONLY. |
| `tests/closed-learning-daemon-order-path-off.test.js` | calls start with order path OFF/ON, counts timers: ON => exactly `setTimeout 0` + `setInterval 30000`; OFF => none (L65-140) |
| `tests/paper-writer-lease-loss-fail-closed.test.js` | start + fatalRequest callback, asserts `POLL_INTERVAL <= LEASE_MS` (L122,L148) |
| `tests/research-startup-recovery.test.js` | start throws `PAPER_WRITER_ALREADY_ACTIVE` / `PAPER_WRITER_LEASE_LOST` (L188-252) |
| `tests/closed-learning-daemon-fatal-exit.test.js` | reads compiled JS, fatal-exit binding of `main` |
| `tests/start-cloud-runtime-supervision.test.js`, `tests/cloud-paper-supervisor.test.js`, `tests/oracle-paper-release-workflow.test.js`, `tests/integration-paper-lifecycle-production-root.test.js`, `tests/repository-truth.test.js`, `tests/report-cloud-reachability.test.js`, `tests/measure-startup-phases.test.js` | entrypoint path / script-wiring pins |
| Source-text pins (read the .ts and regex it): see section 2 | |

## 2. Per-import classification
Group key: A = loop-only, B = shared with PAPER runtime/accounting/lease/risk/shutdown/recovery, C = shared with research, D = governance / strategy identity. "Other importers" = non-test importers besides this file. "T" = number of test files mentioning the module (grep count).

### 2a. Contracts and storage
| Line | Import | Grp | Why | Other importers |
|---|---|---|---|---|
| L3 | node:crypto createHash | - | used only for failure-record fingerprint L334 (loop) | n/a |
| L4 | contracts/researchRuntime `canonicalResearchJson` | C | research canonical JSON; used L334 in loop failure record | many (backtestResearchEvaluator, candidatePromotionRuntime, closedLearning* repo/worker, paperChallengerBindingLedger, liveLifecycleEvidence...) |
| L8 | storage/marketMicrostructureStore `SqliteMarketMicrostructureStore` | C | order-book/trade recorder store | marketMicrostructureRecorder, researchOrderBookCollector, storage index |
| L11 | storage/futuresPublicStore | C | futures collector store | researchFuturesCollector, storage index |
| L12 | contracts/persistedPaperPeriod (type) | B | realized PAPER period envelope type | ~10 files incl. closedLearning*, ownerBaselinePaperPeriod, paperCanonicalOutcomeReconciliation |
| L16 | contracts/strategyGovernance types | D | CommitteeVote, StrategyIdentity, StrategyValidationSummary | candidatePromotionRuntime, canonicalPaperCandidatePerformance, championChallengerManager, strategyGovernance*, strategyPromotionEngine, paperPerformanceGovernanceFeedback |
| L20 | storage/index `SqliteDatabase, SqliteEvolutionLearningLedger, SqlitePaperMarketObservationRepository` | B (Database, observations) / A (EvolutionLearningLedger) | DB is shared by everything; evolution ledger is the loop cycle ledger (L123, L273) | storage index is imported by dozens of cloud files; the evolution ledger's other users not separately grepped |

### 2b. Loop-only core (group A)
| Line | Import | Why (read from code) | Other non-test importers | T |
|---|---|---|---|---|
| L44 | closedLearningProductionConfig | evaluation period, replay snapshot/artifact paths, execution-quality policy (L107) | none | 1 |
| L45 | closedLearningResearchWorkerClient | child-process replay worker (L269) | closedLearningInitialPaperBootstrap, ...ProductionResearchAdapter, ...ResearchDecisionHistory; also imports paperChallengerDeploymentRuntime | 7 |
| L46 | closedLearningResearchDecisionHistory | decision history over DB (L270) | bootstrap, ProductionResearchAdapter | 1 |
| L48 | closedLearningLineageReplayInputSource | builds replay input from periods+bindings (L262) | closedLearningEvidenceIdentitySource | 1 |
| L49 | closedLearningProductionResearchAdapter | research factory (L272) | closedLearningLineageReplayInputSource | 2 |
| L50 | closedLearningEvolutionLedgerRepository | cycle ledger repo (L273, L331, L342-351, L460) | closedLearningLoopStatus, **runtime.ts** | 1 |
| L51 | closedLearningLoopCoordinator (+ cycle helpers/types) | one replay-safe cycle (L283) | ~8 closedLearning* files, paperChallenger* | 5 |
| L53 | closedLearningPendingPeriodReader | read-only checksum view of pending periods (L247) | none | 2 |
| L54 | closedLearningEvidenceIdentitySource | immutable evidence identity (L299) | none | 1 |
| L57 | closedLearningRolloverScheduler | period close/open/rollover (L307) | closedLearningLoopStatus | 2 |
| L58 | closedLearningInitialPaperBootstrap | first Research->PAPER deployment (L287) | closedLearningLoopStatus | 2 |
| L22 | closedLearningLoopStatus (`ClosedLearningLoopStatusTracker`, `tickErrorClass`) | the /health `closedLearningLoop` source (L207, L230) | **researchMetaLearningRuntime** (import found) | 6 |
| L26 | closedLearningBlockedRecord | persists last BLOCKED/ERROR reason (L209-216) | none | 1 |
| L47 | qualifiedPaperChallengerArtifactStore | immutable challenger artifacts (L271) | bootstrap, ProductionResearchAdapter | 1 |

### 2c. Challenger deployment and PAPER-candidate pieces (A/B/D, boundary of the loop)
| Line | Import | Grp | Why | Other importers | T |
|---|---|---|---|---|---|
| L39 | paperChallengerBindingLedger | A/B | binds qualified challengers to the PAPER strategy; ALSO feeds `OwnerBaselinePaperBindingProvider` (L126-131) and the dashboard hydrator => PAPER trading input | closedLearningEvidenceIdentitySource, closedLearningLineageReplayInputSource, paperChallengerDeploymentRuntime; imports cloudRuntimeDashboardHydrator | 5 |
| L52 | paperChallengerDeploymentRuntime | A/B | deploys next PAPER period with the challenger (L274); opens periods on the canonical account | imported by closedLearningResearchWorkerClient, paperChallengerPolicyApproval, qualifiedPaperChallengerArtifactStore | 5 |
| L15 | paperChallengerPolicyApproval | D | canonical Governance approval port, ADR-0018; `NUSA_PAPER_CHALLENGER_POLICY_APPROVAL=DISABLED` makes candidates wait (L279-281) | none | 1 |
| L18 | canonicalPaperCandidatePerformance (`buildCanonicalPaperCandidatePerformance`, `PAPER_COVERED_DAY_SCORING_VERSION`) | B/D | PAPER performance scoring; version constant is part of evidence identity (L300) | canonicalPaperCandidatePerformanceSource, closedLearningLineageReplayInputSource, closedLearningProductionConfig | 2 |
| L19 | paperPerformanceGovernanceFeedback | D | governance feedback from PAPER performance (L372-399) | none | 1 |
| L59 | paperPerformanceFromLedger | B | deterministic Performance Evidence from durable account history+fills (L358-370) | paperPerformanceGovernanceFeedback | 3 |
| L17 | desktop `persistedPaperForwardEvidenceAdapter` | B/C | adapts realized PAPER periods to candidate evidence (L381) | closedLearningLineageReplayInputSource, desktop researchPaperEvidenceBridge | 1 |
| L23 | desktop `FileResearchRunReplaySnapshotStore` | C | replay snapshot file used by Research (L261) | closedLearningEvidenceIdentitySource, closedLearningInitialPaperBootstrap, desktop researchRunReplaySnapshotLatestWorker | 4 |

### 2d. PAPER runtime / accounting / lease / risk / shutdown (group B)
| Line | Import | Why | Other importers | T |
|---|---|---|---|---|
| L1 | paperLeaseStartupWindow | lease-window logging around deferred writer lease (L184-194) | none | 1 |
| L40 | paperTradingExecutionLoop (`PAPER_WRITER_LEASE_DURATION_MS`, `SqliteCloudPaperAccountRepository`, `paperAccountIdForCapital`, `PaperAccountState`) | the canonical PAPER account repo and lease | cloudPaperCanonicalRiskGateway, cloudPaperExecutionBoundary, closedLearningRolloverScheduler, canonicalPaperCandidatePerformance* and more | many |
| L43 | runtime (`isPaperOrderPathEnabled`, `registerGracefulShutdown`, `startCloudRuntimeFromOptions`, `CloudRuntimeHandle`) | the shared cloud runtime; fail-closed order-path rule and graceful shutdown | runtime.ts is the hub (94 test files mention "runtime" by basename, grep imprecise) | many |
| L24 | cloudRuntimeConfig | env config (markets, capital, DB path) | runtime.ts, ai/runtime.ts | 5 |
| L34 | paperAccountRetirement | legacy PAPER account retirement, only when order path ON (L115-121) | none | 2 |
| L32 | runtimeFailureRecord | persists scheduler/startup failure (L545, L623) | runtime.ts | 2 |
| L38 | cloudDashboardSnapshotRepository | dashboard snapshots (L122) | durableCloudDashboardStateProvider, runtime.ts | 1 |
| L37 | cloudRuntimeDashboardHydrator | hydrates dashboard + candidate minute closes (L153) | ownerBaselinePaperStrategy, paperChallengerBindingLedger, runtime.ts | 7 |
| L55 | cloudPaperRiskPolicyIdentity | risk-policy fingerprint used in evidence (L304) | none | 2 |
| L56 | paperRiskLimitScaling | capital-scaled limits, the same ones runtime.ts feeds the risk gateway (L304) | runtime.ts | 1 |
| L25 | paperMarketBenchmark | canonical ticker benchmark for evidence (L305) | runtime.ts | 3 |
| L21 | paperMinuteBars | completed 1-minute bars for the PAPER candidate strategy (L134) | paperPeriodRuleReplay | 1 |
| L42 | paperTradePermissionAuthorityFromEnv | permit authority (default no-permit) passed to runtime (L218-222) | none | 2 |
| L41 | ai/runtime `createCloudAiRuntime` | Cloud AI runtime reusing the verified SQLite connection (L173) | cloud server/runtime | n/a |

### 2e. Owner-baseline strategy and shadows (B / measurement)
| Line | Import | Grp | Why | Other importers | T |
|---|---|---|---|---|---|
| L35 | ownerBaselinePaperStrategy | B/D | the executable PAPER baseline strategy, binding provider, strategy spec (strategy identity) | closedLearningLoopStatus, closedLearningRolloverScheduler, ownerBaselinePaperPeriod | 6 |
| L36 | ownerBaselinePaperPeriod | B | builds the baseline period input (L322-327, L425) | closedLearningInitialPaperBootstrap, paperChallengerDeploymentRuntime, paperRealizedPeriodProducer | 4 |
| L27 | paperBaselineShadow | A (display) | uncensored shadow of baseline rule (L141); "no order, ledger or Risk input" per comment L135 | paperBaselineShadowRecord, paperNullComparators, paperShadowStrategies | 3 |
| L28 | paperShadowStrategies | A (display) | RSI / Donchian shadows (L149) | none | 1 |
| L29 | paperBaselineShadowRecord | A (display) | persist shadow state | none | 1 |
| L30-31 | paperNullComparators(+Record) | A (display) | buy-and-hold / random null comparators | closedLearningLoopStatus imports paperNullComparators | 1 |
| L13 | paperPeriodRuleReplay | A (measurement) | rule-replay parity for last baseline period (L445) | none | 1 |

### 2f. Research-shared (group C)
| Line | Import | Why | Other importers | T |
|---|---|---|---|---|
| L2 | researchMetaLearningRuntime `buildMetaLearningStatus` | steers `longBarTickEvery` (L480-494), shown in /health; it imports closedLearningLoopStatus (type coupling) | none | 2 |
| L5 | researchLedgerSnapshot `RESEARCH_LEDGER_SNAPSHOT` | reviewed research ledger | none | 3 |
| L6 | researchStudyResult `readOrderBookStudyResult` | order-book study result joins ledger (L482) | runtime.ts | 1 |
| L7 | marketMicrostructureRecorder | WS order-book/trade recorder (L198) | runtime.ts | 1 |
| L9 | researchOrderBookCollector | 1-min all-KRW order book (L202) | runtime.ts | 1 |
| L10 | researchFuturesCollector | Binance public futures (L206) | runtime.ts | 1 |
| L14 | researchExperimentComposition | continuous research experiments (L177) | runtime.ts | 9 |
| L33 | researchSnapshotRefresher | requests a Research snapshot when bootstrap waits (L410, L474) | none | 1 |

### 2g. Major local definitions in the file
| Item | Lines | Grp | Why |
|---|---|---|---|
| `startupMark` | 66-71 | B | startup-phase timing log, no state |
| composition `startClosedLearningProductionRuntime` | 105-608 | A+B+C mix | one function, 500 lines; see 2h |
| `assertOrderPathEnabled`, `*Async` guards | 113-114, 284-297, 355-356 | A on B | loop entry points refuse when order path OFF (throw `PAPER_ORDER_PATH_OFF`) |
| `periods` facade (L248-259) | | A on B | adapter over `baseHandle` realized-period functions (owned by runtime.ts) |
| `readPaperPerformanceEvidence` | 358-370 | B/D | read-only; fail-closed errors if no history/fills/match |
| `evaluatePaperGovernanceFeedback` | 372-399 | D | requires order path; returned but not in interface |
| `ensureOwnerBaselinePeriod` | 416-432 | B | opens an owner-baseline period when no periods exist; PAPER continuity fallback |
| `latestBaselineRuleReplay` | 436-452 | A | display only |
| `runClosedLearningTick` | 454-520 | A | serialized async tick (bootstrap, rollover, meta, shadows, status) |
| `handle` wrapper `stop` | 522-540 | B | stops refresher, experiments, timers, awaits tick, then `baseHandle.stop()` |
| `failClosedScheduler` / `scheduleTick` | 542-551 | B | exit code 1, `recordRuntimeFailure`, fatal shutdown request |
| lease/recovery sequence | 555-576 | B/C | `prepareRecovery` -> `startPaperRuntime` -> `recoverResearch` -> `experiments.start` with `verifyWriterLease()` between phases |
| scheduler arming | 582-587 | A | only when `orderPathEnabled` |
| `main()` | 610-627 | B | records startup failure, registers graceful shutdown |

### 2h. Tick contents (L454-513): what is "loop" vs side duties
The tick, which exists only when the order path is ON (L582), also does non-loop duties: `paperRepository.verifyWriterLease()` (L466, lease check, B), `researchRefresh.requestIfDue()` (C), `ensureOwnerBaselinePeriod()` (B), meta-learning (C) which sets `longBarTickEvery` read by research experiments (L176-177, L492, L494), shadow persistence (display), and `persistLastBlocked()`. Removing the tick therefore removes: the periodic lease verification in this process, the meta-learning steering of research tick cadence, and baseline-period opening. Whether other code also verifies the lease periodically (repository heartbeat) is stated in comments (L559-561, "repository heartbeat") but I did not trace it in paperTradingExecutionLoop.

## 3. Tests that would break if loop-only (A) components were removed
Method: grep of module names in tests/ and `apps/**/*.test.ts`. "Pure unit" tests of a removed module would simply be deleted with it; the interesting ones are cross-cutting tests that would FAIL for lack of the symbol or source text. Not run.

### 3a. Cross-cutting tests that pin text or behaviour in the production file (would fail if the code moved or vanished)
| Test | Pin |
|---|---|
| tests/closed-learning-http-event-loop-regression.test.js | requires `runClosedLearningBootstrapAsync`, `runClosedLearningRolloverAsync`, `setTimeout(scheduleTick,0)`, `setInterval(scheduleTick, CLOSED_LEARNING_ROLLOVER_POLL_INTERVAL_MS)` in source (L8-15) |
| tests/closed-learning-governance-wiring.test.js | `governance: new PaperChallengerPolicyApproval(` in the deployment constructor; writer-lease verify before bootstrap (L17-31) |
| tests/closed-learning-loop-status.test.js | reads the .ts three times (L42, L356, L420) for tracker wiring; also imports closedLearningEvolutionLedgerRepository |
| tests/closed-learning-daemon-order-path-off.test.js | timers: exactly `setTimeout 0` + `setInterval 30000` when ON, none OFF; uses `CLOSED_LEARNING_ROLLOVER_POLL_INTERVAL_MS`; paperAccountRetirement |
| tests/paper-writer-lease-loss-fail-closed.test.js | uses the constant `<= LEASE_MS`; start + fatal callback |
| tests/paper-startup-lease-budget-2770.test.js | requires `scheduler` marker to come after `startCloudRuntimeFromOptions({` and lease ordering (L101-109, L136) |
| tests/paper-writer-lease-liveness.test.js | ordering lease -> runtime -> startLease; `deferPaperRuntimeStart: true`; Cloud AI shares DB |
| tests/paper-minute-bars.test.js (L54) | production composition wires minute closes from persisted ticker store |
| tests/paper-risk-limit-scaling.test.js (L44) | evidence `riskConfigHash` uses the same scaled limits as the gateway |
| tests/paper-trade-permission-authority-from-env.test.js (L95), tests/paper-trade-permission-enforcement.test.js (L378), tests/paper-trade-permission-store.test.js (L192) | permit authority wiring text in the production file |
| tests/cloud-runtime-options.test.js (L23) | production uses `startCloudRuntimeFromOptions({` named options only |
| tests/paperNullComparators.test.ts (L177) | reads the production .ts (shadow wiring) |
| tests/production-entry-boot-modes.test.js, tests/research-startup-recovery.test.js | real boot; would pass only if start/stop semantics are kept |

### 3b. Unit/integration tests per loop-only module (removed together with the module)
| Module | Test files |
|---|---|
| closedLearningBlockedRecord | apps/cloud/src/closedLearningBlockedRecord.test.ts |
| closedLearningEvidenceIdentitySource | ...EvidenceIdentitySource.test.ts |
| closedLearningEvolutionLedgerRepository | tests/closed-learning-loop-status.test.js (also imported non-test by runtime.ts: removal affects runtime.ts) |
| closedLearningInitialPaperBootstrap | its .test.ts, tests/closed-learning-qualification-summary.test.js |
| closedLearningLineageReplayInputSource | its .test.ts |
| closedLearningLoopCoordinator | closedLearningCycleComplete, closedLearningLoopCoordinator, closedLearningProductionResearchAdapter, closedLearningRolloverScheduler tests; tests/closed-learning-http-event-loop-regression.test.js |
| closedLearningLoopStatus | closedLearningBlockedRecord, closedLearningRolloverScheduler, paperPeriodRuleReplay tests; tests/closed-learning-loop-status.test.js, closed-learning-progress-truth.test.js, cloud-runtime-liveness-health.test.js |
| closedLearningPendingPeriodReader | its test; paperIncompletePeriodProgression.test.ts |
| closedLearningProductionConfig | its test |
| closedLearningProductionResearchAdapter | its test; tests/closed-learning-http-event-loop-regression.test.js |
| closedLearningResearchDecisionHistory | its test |
| closedLearningResearchWorkerClient | its test; bootstrap, adapter, history tests; closed-learning-http-event-loop-regression, research-factory-qualification, research-worker-qualification-identity (tests/*.js) |
| closedLearningRolloverScheduler | its test; paperIncompletePeriodProgression.test.ts |
| qualifiedPaperChallengerArtifactStore | its test |
| paperChallengerBindingLedger | its test; closedLearningEvidenceIdentitySource, paperChallengerDeploymentRuntime(.handoff), paperChallengerPolicyApproval tests |
| paperChallengerDeploymentRuntime | its tests (2), paperChallengerPolicyApproval, qualifiedPaperChallengerArtifactStore, closedLearningProductionResearchAdapter tests |
| paperChallengerPolicyApproval | its test |
| paperPerformanceGovernanceFeedback / paperPerformanceFromLedger | their tests; tests/integration-paper-lifecycle-identity-continuity.test.js (FromLedger) |
| canonicalPaperCandidatePerformance | its test, canonicalPaperCandidatePerformanceSource.test.ts |
| paperBaselineShadow, paperShadowStrategies, paperNullComparators, ...Record, paperPeriodRuleReplay | their own tests (paperBaselineShadow/NullComparators/ShadowStrategies/PeriodRuleReplay) |
| ownerBaselinePaperStrategy / Period (B, listed because loop modules import them) | their tests; closedLearningRolloverScheduler, closedLearningInitialPaperBootstrap, paperChallengerDeploymentRuntime, paperRealizedPeriodProducer tests |
| /health readers (not removed, but affected) | apps/cloud/src/learningLoopVerdict.test.ts, tests/learning-pipeline-stage.test.js, tests/cloud-runtime-liveness-health.test.js, tests/health-watch.test.js, tests/oracle-host-diagnose-workflow.test.js (fixture with `learningLoopVerdict`), tests/nusa-control*.test.js (mention runMode/orderPathReady/closedLearningLoop) |

Not determined: whether any `tests/*.js` reads these modules through paths my basename grep missed (e.g. `dist/...` strings built dynamically); and the full set of nusa-control tests that assert on `closedLearningLoop` content versus only runMode.

## 4. How /health exposes the loop (read from code) and what fails closed when it is off

### 4a. Data path
1. The composition passes `closedLearningStatus: () => loopStatus.snapshot()` (L230). `startCloudRuntimeFromOptions` forwards it (runtime.ts:227, :257, positional slot 15 at :286).
2. `runtime.ts:851` `closedLearningLiveness()` returns `{}` if the status is null/throws, else `{ closedLearningLoop: status }`. So with no tracker the key is simply absent.
3. `server.ts:485-604` sanitises `source.closedLearningLoop` field by field and includes it only if `loop.bootstrap !== undefined && loop.rollover !== undefined` (server.ts:604). Default tracker values are strings `NOT_RUN` (closedLearningLoopStatus.ts:121 for bootstrap; rollover default not read by me), so in COLLECT_ONLY the tracker still reports a block with NOT_RUN states.
4. `learningPipelineProjection` (learningPipelineStage.ts:96-103): learning stage = `UNKNOWN` if `closedLearningLoop.cyclesEvaluated` is missing, `LEARNING_NOT_EVALUATED` if 0, `PASS` if > 0.
5. `learningLoopVerdict(runtime, pipeline)` (learningLoopVerdict.ts:59-130), exposed by `server.ts:1052-1058` as top-level `/health.learningLoopVerdict`. Reads `cyclesEvaluated`, `cyclesRecorded`, `cyclesRecordedAtBoot`, `rollover`, `lastErrorClass`, `metaLearning.{experiments,discoveryPasses,holdoutPasses}`, `evidence.open*`. Verdict rules: FAILED if rollover=="ERROR" or an error class; LOOP_VERIFIED only if first broken stage is NONE and cyclesEvaluated>0 and cyclesRecorded>0; UNKNOWN if any criterion unreadable; else PARTIAL (trading PASS) or BLOCKED. Missing fields read UNKNOWN, never PASS (code comment at top of file and the rules above).
6. runMode: `runtime.ts:118-128` `isPaperOrderPathEnabled`: true only if `NUSA_PAPER_ORDER_PATH === "ON"` and `NUSA_RUN_MODE` is unset-or-`PAPER_ORDERS`; with `NUSA_REQUIRE_RUN_MODE=1` an unset run mode also means off. `/health.runtime.runMode` = `effectiveMode` (runtime.ts:921); `orderPathReady` = `effectivePaperLoop != null && productionPaperBoundary != null` (runtime.ts:923). Both are validated and re-emitted in server.ts:679-681 only when of the exact expected type.
7. App heartbeat: runtime.ts:380-420 builds `learningFunnel` (with `loopVerdict` from `learningLoopVerdict`) and `learningLoop` from `closedLearningStatus()`, display only, fields dropped when inconsistent. Contract: packages/contracts/src/personalPaperOperations.ts:68, :116-121, :191-193, validator at :502.

### 4b. What the mobile 학습 screen reads
- `apps/mobile/src/learningScreenModel.ts` does NOT read `closedLearningLoop` or `learningLoopVerdict`. It builds from `PaperLearningScreenState` (paperLearningScreen.ts: market, signal, decision, risk, fill, evidence outcome, performance, timeline, status PAUSED/HALTED/ERROR) plus one option `collectOnly` (L24, L65-66). With `collectOnly && status==="PAUSED" && no risk block && no halt` it shows a neutral tone and the sentence "수집 전용이라 판단은 쉬어요". HALTED/ERROR/risk FAIL still win and missing data renders "—"/"받지 못함" (L63-97).
- The loop-specific display lives in `apps/mobile/src/learningView.tsx` (funnel via `learningFunnelModel.ts` which reads `loopVerdict` at :86; `CostWaterfall`, `NullComparison`, `PaperResultBars`, `OverfitGate` read `learningLoop`) and `connectionLabelModel.ts` (COLLECT_ONLY label "수집 전용"), `nowScreenModel.ts`, `safetyLineModel.ts`, `homeFieldInput.ts`, `intelligenceFieldModel.ts` (all treat COLLECT_ONLY as designed state, "not a fault").
- Not determined: how the app treats a `learningFunnel`/`learningLoop` that is entirely absent beyond `learningView.tsx` props being optional (`learningFunnel?: unknown`, null when stale/absent per comment L16); I did not read the rendering components.

### 4c. What fails closed (read from code)
| Situation | Result |
|---|---|
| Order path OFF (COLLECT_ONLY) | no writer lease, no PAPER repo (L185-186), no retirement (L115), no scheduler (L582), async entry points reject `PAPER_ORDER_PATH_OFF` (L285, L297, L356); `runMode=COLLECT_ONLY`, `orderPathReady=false` |
| `NUSA_RUN_MODE` set to anything but `PAPER_ORDERS`, or required-but-unset | order path off (runtime.ts:119-122) |
| Loop status absent | `closedLearningLoop` omitted; cyclesEvaluated undefined => stage `UNKNOWN`, verdict `UNKNOWN` (never PASS) |
| Loop present, nothing evaluated | `LEARNING_NOT_EVALUATED`; verdict BLOCKED/PARTIAL; `cycleWaitingFor=NO_DEPLOYABLE_CANDIDATE` only if holdoutPasses===0 |
| Governance approval disabled | candidates wait; no deployment (L279-281, ADR-0018) |
| Scheduler tick throws | `failClosedScheduler`: exit code 1, runtime failure recorded, fatal shutdown (L542-550) |
| Startup/lease failure | `baseHandle.stop()` and rethrow; `finishPreparedRecovery()` releases SQLite trackers (L570-576, L602-607) |
| Permit authority missing | `FALLBACK_NO_PERMIT`: no strategy order created (L217-219) |

## 5. Proposed order of a SAFE staged cleanup (map only; no code changes proposed now)
Principle: stage 0 changes nothing at runtime; each later stage needs the listed regression tests green BEFORE and AFTER, and removal lands only after a release that proves the same behaviour with the component already inert.

0. Freeze facts (no code): record per-module importer table (section 2) in the work order; mark which A modules still have non-test importers outside the loop: `closedLearningEvolutionLedgerRepository` (runtime.ts), `closedLearningLoopStatus` (researchMetaLearningRuntime), `paperChallengerDeploymentRuntime` (imported by closedLearningResearchWorkerClient, paperChallengerPolicyApproval, qualifiedPaperChallengerArtifactStore), `ownerBaselinePaperStrategy` (imported by status and scheduler). Those are the coupling points to cut first.
1. Isolate by seam, not by deletion: put the loop behind one factory (e.g. a `LoopController` returned from a function that today lives in this file) while keeping `startClosedLearningProductionRuntime` signature and the exported symbols (section 1a). Regression tests that must exist and pass first: production-entry-boot-modes, closed-learning-daemon-order-path-off (timer count), paper-writer-lease-loss-fail-closed, research-startup-recovery, paper-startup-lease-budget-2770, paper-writer-lease-liveness, cloud-runtime-options. Missing today (propose to add before removal): a test that with the loop disabled (not just order path off) `/health` still has `runMode`, `orderPathReady`, `learningLoopVerdict.verdict === "UNKNOWN"` and no throw; a test that the PAPER lease is still verified periodically when the tick is absent (see risk R1).
2. Separate side duties out of the tick: lease verify (L466), `ensureOwnerBaselinePeriod` (L416), meta-learning steering of `longBarTickEvery` (L480-494), `researchRefresh.requestIfDue` (L474). Each needs its own scheduler/test before the tick shrinks. These are the pieces that are NOT "learning" yet live in the tick.
3. Cut type coupling: move the status shape out of `closedLearningLoopStatus` for `researchMetaLearningRuntime`; make `runtime.ts` stop importing `closedLearningEvolutionLedgerRepository` (or keep a read-only stub that returns NOT_RUN).
4. Make the /health contract explicit: keep `closedLearningLoop`, `learningLoopVerdict` and `learningFunnel`/`learningLoop` as optional, add a contract test pinning "absent => UNKNOWN, never PASS" (learningLoopVerdict.test.ts already covers verdict logic; confirm it covers missing `closedLearningLoop`; not determined). Mobile: confirm `learningView.tsx` renders absent `learningFunnel`/`learningLoop` as missing, not zero.
5. Quarantine the display-only shadows (paperBaselineShadow, shadows, null comparators, rule replay): they feed `/health` only (comment L135, L138; they do not touch orders). Safe to turn off later by env-gating, but `ownerBaselineStrategyEnabled(env)` also gates the executable baseline (L126-131), so gate shadows separately.
6. Only then retire A modules in leaf-first order: closedLearningBlockedRecord, rollover scheduler, bootstrap, coordinator, research adapter / worker client / history, lineage replay, evidence identity, pending reader, config; keep challenger deployment + governance (D) until the Alpha Lab pivot decides their fate, since PAPER binding and ADR-0018 still reference them.
7. Update the guards that read the file as text (section 3a) in the SAME change as the move, and `scripts/report-cloud-reachability.js` / `validate-repository-truth.js` file lists.

## 6. Risks (silently weakening a gate, lease, kill switch or invariant)
- R1 Lease verification lives in the tick. `paperRepository?.verifyWriterLease()` is called at L466 inside `runClosedLearningTick`; the comment (L464-465) says a lost lease is terminal and relies on that check to fail closed. Removing/disarming the tick would drop this periodic in-process check. The runtime also verifies between startup phases (L561-569) and mentions a repository heartbeat (L559-561); I did not read the heartbeat implementation, so whether the lease is still enforced without the tick is NOT determined. tests/paper-writer-lease-loss-fail-closed.test.js is the guard.
- R2 Shutdown ordering. `stop` (L524-538) awaits the in-flight tick before `baseHandle.stop()`. Removing the tick must keep timer clearing and ordering, and `registerGracefulShutdown` / `failClosedScheduler` exit-code semantics (tests/closed-learning-daemon-fatal-exit.test.js).
- R3 Order-path gate. All loop entry points call `assertOrderPathEnabled` or reject; the timers exist only when `orderPathEnabled` (L582). A refactor that arms timers unconditionally, or moves `ensureOwnerBaselinePeriod` (opens a PAPER period, L431) outside the guard, would let OFF mode mutate PAPER state. L110-114 documents the 2026-11-15 crash-loop that this prevents.
- R4 Governance port. `paperChallengerPolicyApproval` default is ON in PAPER and `DISABLED` makes candidates wait (L279-281). Deleting loop code that wires `governance:` while leaving the deployment runtime would remove approval; tests/closed-learning-governance-wiring.test.js pins the text, not semantics. Strategy-governance types (L16) and `evaluatePaperGovernanceFeedback` (L372) are D-group and also used by champion/challenger code.
- R5 Evidence identity binds PAPER risk policy and scoring version (`PAPER_COVERED_DAY_SCORING_VERSION` L300, risk fingerprint L304). If the loop is removed these become unused, and nothing may notice that the evidence fingerprint no longer tracks the enforced capital-scaled limits (guard: tests/paper-risk-limit-scaling.test.js L44).
- R6 Meta-learning steers research cadence (`longBarTickEvery`, L176-177, L492-494). Without the tick it stays at 1: research tick behaviour changes silently (meta also updates `/health.metaLearning`, which feeds `learningLoopVerdict.candidateFunnel`).
- R7 Owner-baseline strategy is both loop component and executable PAPER strategy: `OwnerBaselinePaperBindingProvider` is passed to the dashboard hydrator (L126-161), and periods are built from `ownerBaselinePaperPeriod`. It is not loop-only; removing "loop" files that import it must not remove the binding.
- R8 Invariants PAPER_ONLY / liveAuthority=NONE / aiAuthority=ZERO_AUTHORITY: I found no LIVE route or AI authority code in this file (header comment L97-104 claims none; grep of the file for "live"/"authority" beyond the permit authority was not exhaustive). The permit authority defaults to no-permit (L217-222). Where `liveAuthority=NONE`, `productionMutationAllowed=false` and `aiAuthority=ZERO_AUTHORITY` are enforced (probably in contracts/server/validators) was not located in this pass; a cleanup must keep those validators and their tests untouched. Cloud AI runtime (L173) is constructed here, so moving it must keep it read-only/zero-authority; not verified.
- R9 Reachability and release gates. `report-cloud-reachability.js` roots (script:55), `validate-repository-truth.js` file list and oracle-paper-release smoke require this file path and its compiled `.js`: renaming or splitting the entry breaks deployment checks before it breaks any runtime behaviour.
- R10 Observability regression, not safety: with the loop gone, /health returns `learningLoopVerdict=UNKNOWN`, nusa-control/health-watch/host-diagnose tooling and the mobile funnel may read this as a fault or hide it; their expectations (tests listed in 3b) must be updated deliberately.
- R11 Stale `dist/**/*.test.js` without a source is not a real failure (CLAUDE.md note 7); several tests read `dist/` output of this file, so build before judging.

## 7. Could not determine (plain list)
- Behaviour of rollover default status string and exact `/health` output of a freshly booted COLLECT_ONLY node (read from code only; production-entry-boot-modes.test.js asserts only runMode, lease rows and fills).
- Whether anything besides the tick keeps the writer lease heartbeat alive and fails closed on loss (R1).
- Non-test importers hidden by multi-line or dynamic imports; usage of `evaluatePaperGovernanceFeedback` and `readPaperPerformanceEvidence` outside this file and tests.
- Rendering of absent funnel/loop data in mobile components beyond the models read.
- Where the three safety invariants are enforced outside this file.
- Which tests actually fail: nothing was built or run.
