# Cloud code census — 2026-10-28 (read-only)

Phase 4 input for `docs/PROPOSAL_TARGET_ARCHITECTURE_2026-10.md`. Nothing here is deleted or moved.

Method: `node scripts/report-cloud-reachability.js` (committed with this census) builds a static closure over import, export-from, `import()` and `require` of relative paths, over the 301 top-level non-test modules in `apps/cloud/src`. Host entries are `closedLearningProductionRuntime.ts` (the host start), `runtime.ts` and every `apps/cloud/src/*` file referenced from `scripts/`, `deploy/` or `.github/`; product entries add every non-test source file in desktop, mobile, autopilot and packages. Result on main 2026-10-28: **166 HOST, 25 PRODUCT_SURFACE_KEEP, 20 LIVE_BOUNDARY_KEEP, 90 UNREACHED_CHECK**. Dynamic module names are not followed, so even UNREACHED_CHECK needs a per-module check. The earlier figure in PR #2909 (136, about 45%) used narrower entries and is corrected there.

Categories: HOST rows are omitted. PRODUCT_SURFACE_KEEP and LIVE_BOUNDARY_KEEP (fail-closed LIVE-blocking boundaries and their suites) stay; only UNREACHED_CHECK rows are candidates.

Columns: last commit date, lines, number of test files that mention the module, number of other cloud modules that import it (an importer count above 0 means it is part of an unreached cluster).

| Module | Category | Last change | Lines | Tests | Imported by |
| --- | --- | --- | ---: | ---: | ---: |
| `atomicHedgeCoordinator.ts` | PRODUCT_SURFACE_KEEP | 2026-07-12 | 188 | 2 | 2 |
| `championDashboard.ts` | UNREACHED_CHECK | 2026-07-12 | 40 | 1 | 0 |
| `complianceReport.ts` | UNREACHED_CHECK | 2026-07-12 | 42 | 1 | 0 |
| `conflictAnalyzer.ts` | UNREACHED_CHECK | 2026-07-12 | 4 | 0 | 0 |
| `consensusEngine.ts` | UNREACHED_CHECK | 2026-07-12 | 3 | 0 | 0 |
| `controlCommandProcessor.ts` | UNREACHED_CHECK | 2026-07-12 | 131 | 1 | 1 |
| `dailyAiAudit.ts` | PRODUCT_SURFACE_KEEP | 2026-07-12 | 181 | 1 | 0 |
| `dataFeaturePipeline.ts` | UNREACHED_CHECK | 2026-07-12 | 79 | 1 | 1 |
| `deltaNeutralMonitor.ts` | UNREACHED_CHECK | 2026-07-12 | 83 | 1 | 0 |
| `disasterRecovery.ts` | UNREACHED_CHECK | 2026-07-12 | 50 | 2 | 1 |
| `evidenceBundle.ts` | UNREACHED_CHECK | 2026-07-12 | 50 | 23 | 1 |
| `featureCioAdapter.ts` | UNREACHED_CHECK | 2026-07-12 | 47 | 1 | 0 |
| `fundingCarryEngine.ts` | UNREACHED_CHECK | 2026-07-12 | 184 | 0 | 0 |
| `fundingCarryExitEngine.ts` | UNREACHED_CHECK | 2026-07-12 | 110 | 1 | 0 |
| `fundingCarryReadOnlyStatus.ts` | UNREACHED_CHECK | 2026-07-12 | 35 | 1 | 0 |
| `fundingCarryScanner.ts` | UNREACHED_CHECK | 2026-07-12 | 120 | 1 | 0 |
| `hedgeRecoveryLedger.ts` | PRODUCT_SURFACE_KEEP | 2026-07-12 | 110 | 1 | 0 |
| `investmentCommittee.ts` | UNREACHED_CHECK | 2026-07-12 | 149 | 4 | 1 |
| `memberScoring.ts` | UNREACHED_CHECK | 2026-07-12 | 3 | 0 | 1 |
| `operationalReadinessGate.ts` | PRODUCT_SURFACE_KEEP | 2026-07-12 | 59 | 2 | 1 |
| `operatorRunbook.ts` | UNREACHED_CHECK | 2026-07-12 | 35 | 2 | 0 |
| `operatorTimeline.ts` | PRODUCT_SURFACE_KEEP | 2026-07-12 | 35 | 1 | 0 |
| `opportunityAttribution.ts` | PRODUCT_SURFACE_KEEP | 2026-07-12 | 151 | 1 | 1 |
| `opportunityLifecycle.ts` | UNREACHED_CHECK | 2026-07-12 | 123 | 1 | 0 |
| `opportunityScheduler.ts` | PRODUCT_SURFACE_KEEP | 2026-07-12 | 168 | 1 | 0 |
| `paperValidationEvidence.ts` | UNREACHED_CHECK | 2026-07-12 | 152 | 1 | 1 |
| `positionRotationEngine.ts` | UNREACHED_CHECK | 2026-07-12 | 101 | 1 | 0 |
| `probabilityEdgeEngine.ts` | UNREACHED_CHECK | 2026-07-12 | 72 | 1 | 1 |
| `runtimeHealthMonitor.ts` | PRODUCT_SURFACE_KEEP | 2026-07-12 | 170 | 1 | 0 |
| `runtimeIncidentReport.ts` | PRODUCT_SURFACE_KEEP | 2026-07-12 | 37 | 1 | 1 |
| `runtimeOrchestrator.ts` | PRODUCT_SURFACE_KEEP | 2026-07-12 | 157 | 1 | 2 |
| `strategyLifecycleView.ts` | UNREACHED_CHECK | 2026-07-12 | 40 | 1 | 0 |
| `temporalBinaryHedgePlanner.ts` | UNREACHED_CHECK | 2026-07-12 | 162 | 1 | 0 |
| `transactionalControlCommandService.ts` | UNREACHED_CHECK | 2026-07-12 | 49 | 1 | 0 |
| `versionProvenance.ts` | UNREACHED_CHECK | 2026-07-12 | 25 | 1 | 1 |
| `alphaEvidenceRegistry.ts` | UNREACHED_CHECK | 2026-07-13 | 104 | 2 | 1 |
| `architectureAudit.ts` | UNREACHED_CHECK | 2026-07-13 | 214 | 1 | 0 |
| `championMonitor.ts` | UNREACHED_CHECK | 2026-07-13 | 173 | 1 | 0 |
| `edgeDecayMonitor.ts` | PRODUCT_SURFACE_KEEP | 2026-07-13 | 183 | 1 | 1 |
| `featureRegistry.ts` | UNREACHED_CHECK | 2026-07-13 | 182 | 1 | 0 |
| `operationalCompletionGate.ts` | UNREACHED_CHECK | 2026-07-13 | 141 | 1 | 1 |
| `platformTopology.ts` | UNREACHED_CHECK | 2026-07-13 | 143 | 2 | 1 |
| `profitabilityClaimGate.ts` | UNREACHED_CHECK | 2026-07-13 | 92 | 1 | 0 |
| `releaseReadinessAudit.ts` | UNREACHED_CHECK | 2026-07-13 | 116 | 2 | 2 |
| `researchBacklog.ts` | UNREACHED_CHECK | 2026-07-13 | 114 | 1 | 0 |
| `paperFaultDrill.ts` | UNREACHED_CHECK | 2026-07-15 | 71 | 1 | 0 |
| `releaseEvidenceAuthority.ts` | UNREACHED_CHECK | 2026-07-15 | 61 | 1 | 0 |
| `versionedScenarioEvidence.ts` | UNREACHED_CHECK | 2026-07-15 | 30 | 1 | 0 |
| `monteCarloResearch.ts` | PRODUCT_SURFACE_KEEP | 2026-07-16 | 79 | 2 | 0 |
| `operatorEvidenceBundle.ts` | PRODUCT_SURFACE_KEEP | 2026-07-16 | 165 | 2 | 2 |
| `releaseEvidenceDashboard.ts` | PRODUCT_SURFACE_KEEP | 2026-07-16 | 102 | 1 | 1 |
| `scenarioEvidenceBundle.ts` | PRODUCT_SURFACE_KEEP | 2026-07-16 | 170 | 3 | 2 |
| `scenarioPaperValidation.ts` | PRODUCT_SURFACE_KEEP | 2026-07-16 | 85 | 2 | 3 |
| `complianceControlPlane.ts` | UNREACHED_CHECK | 2026-07-20 | 74 | 1 | 0 |
| `resilienceControlPlane.ts` | UNREACHED_CHECK | 2026-07-20 | 43 | 1 | 0 |
| `rulesControlPlane.ts` | UNREACHED_CHECK | 2026-07-20 | 327 | 1 | 0 |
| `alphaBibleGenerator.ts` | UNREACHED_CHECK | 2026-08-01 | 121 | 1 | 0 |
| `exchangeSymbolResolver.ts` | UNREACHED_CHECK | 2026-08-02 | 70 | 1 | 1 |
| `paperScenarioEvidenceLedger.ts` | PRODUCT_SURFACE_KEEP | 2026-08-02 | 23 | 5 | 3 |
| `paperScenarioEvidenceRecorder.ts` | UNREACHED_CHECK | 2026-08-05 | 22 | 3 | 2 |
| `runtimeCommandService.ts` | UNREACHED_CHECK | 2026-08-06 | 251 | 9 | 1 |
| `dashboardAggregator.ts` | PRODUCT_SURFACE_KEEP | 2026-08-07 | 205 | 1 | 1 |
| `researchHardeningComponents.ts` | UNREACHED_CHECK | 2026-08-08 | 43 | 0 | 0 |
| `investmentCommitteeLedger.ts` | PRODUCT_SURFACE_KEEP | 2026-08-09 | 6 | 0 | 0 |
| `runtimeEventBus.ts` | PRODUCT_SURFACE_KEEP | 2026-08-15 | 53 | 1 | 1 |
| `runtimeReplay.ts` | PRODUCT_SURFACE_KEEP | 2026-08-15 | 45 | 1 | 1 |
| `controlPlane.ts` | UNREACHED_CHECK | 2026-08-21 | 1 | 19 | 1 |
| `marketConnectionSupervisor.ts` | UNREACHED_CHECK | 2026-08-21 | 1 | 3 | 0 |
| `paperApprovalService.ts` | UNREACHED_CHECK | 2026-08-21 | 1 | 3 | 0 |
| `paperBroker.ts` | UNREACHED_CHECK | 2026-08-21 | 1 | 31 | 2 |
| `paperOperationalPreflight.ts` | UNREACHED_CHECK | 2026-08-21 | 377 | 8 | 0 |
| `paperRiskState.ts` | UNREACHED_CHECK | 2026-08-21 | 1 | 6 | 1 |
| `paperSafetyGates.ts` | UNREACHED_CHECK | 2026-08-21 | 1 | 4 | 1 |
| `regimePolicy.ts` | UNREACHED_CHECK | 2026-08-21 | 1 | 3 | 1 |
| `runtimeMutationDiagnostics.ts` | UNREACHED_CHECK | 2026-08-21 | 1 | 2 | 1 |
| `strategyEngine.ts` | UNREACHED_CHECK | 2026-08-21 | 1 | 17 | 1 |
| `liveExecutionBoundary.ts` | LIVE_BOUNDARY_KEEP | 2026-08-23 | 201 | 2 | 0 |
| `paperChaosEvidenceProvenance.ts` | UNREACHED_CHECK | 2026-08-28 | 161 | 2 | 2 |
| `paperChaosGitHubRunLookup.ts` | UNREACHED_CHECK | 2026-08-28 | 159 | 1 | 0 |
| `operationalProgressHttp.ts` | UNREACHED_CHECK | 2026-08-29 | 20 | 1 | 0 |
| `paperExecutionCostAttribution.ts` | UNREACHED_CHECK | 2026-08-29 | 97 | 1 | 0 |
| `paperPortfolioPerformanceEvidence.ts` | UNREACHED_CHECK | 2026-08-29 | 202 | 1 | 0 |
| `evolutionDriftDetection.ts` | UNREACHED_CHECK | 2026-08-30 | 156 | 1 | 0 |
| `liveAutonomousPreExecutionGate.ts` | LIVE_BOUNDARY_KEEP | 2026-08-30 | 191 | 2 | 2 |
| `liveBrokerTransportAdapter.ts` | LIVE_BOUNDARY_KEEP | 2026-08-30 | 41 | 1 | 0 |
| `liveBrokerTransportBoundaryV3.ts` | LIVE_BOUNDARY_KEEP | 2026-08-30 | 21 | 1 | 2 |
| `liveExecutionAuditEvidence.ts` | LIVE_BOUNDARY_KEEP | 2026-08-30 | 50 | 0 | 0 |
| `liveExecutionConsumeOnce.ts` | LIVE_BOUNDARY_KEEP | 2026-08-30 | 41 | 4 | 4 |
| `liveHumanApprovalConsumptionGate.ts` | LIVE_BOUNDARY_KEEP | 2026-08-30 | 89 | 1 | 1 |
| `liveHumanApprovalDurableConsumptionStore.ts` | LIVE_BOUNDARY_KEEP | 2026-08-30 | 51 | 1 | 0 |
| `liveHumanApprovalGate.ts` | LIVE_BOUNDARY_KEEP | 2026-08-30 | 107 | 2 | 1 |
| `liveRuntimeSessionBoundary.ts` | LIVE_BOUNDARY_KEEP | 2026-08-30 | 54 | 2 | 3 |
| `liveRuntimeSessionCommands.ts` | LIVE_BOUNDARY_KEEP | 2026-08-30 | 63 | 0 | 0 |
| `liveRuntimeSessionState.ts` | LIVE_BOUNDARY_KEEP | 2026-08-30 | 103 | 1 | 0 |
| `liveSessionBoundPreExecution.ts` | LIVE_BOUNDARY_KEEP | 2026-08-30 | 47 | 2 | 3 |
| `liveSessionRevisionAuthorization.ts` | LIVE_BOUNDARY_KEEP | 2026-08-30 | 47 | 0 | 1 |
| `ownerCapitalAllocationCeiling.ts` | UNREACHED_CHECK | 2026-08-30 | 61 | 1 | 0 |
| `paperAutoLearningRuntime.ts` | UNREACHED_CHECK | 2026-08-30 | 208 | 4 | 0 |
| `paperAutonomousDecisionValidation.ts` | UNREACHED_CHECK | 2026-08-30 | 65 | 1 | 1 |
| `paperOutcomeCalibration.ts` | PRODUCT_SURFACE_KEEP | 2026-08-30 | 225 | 1 | 1 |
| `paperPortfolioAdvisory.ts` | UNREACHED_CHECK | 2026-08-30 | 176 | 1 | 0 |
| `paperPortfolioRiskEvidence.ts` | UNREACHED_CHECK | 2026-08-30 | 328 | 2 | 1 |
| `researchEvolutionFeedback.ts` | PRODUCT_SURFACE_KEEP | 2026-08-30 | 81 | 1 | 0 |
| `strategyEvolutionLedger.ts` | UNREACHED_CHECK | 2026-08-30 | 98 | 1 | 0 |
| `liveAuthoritativeSessionTransportChain.ts` | LIVE_BOUNDARY_KEEP | 2026-08-31 | 44 | 0 | 2 |
| `liveBrokerDispatchDurableState.ts` | LIVE_BOUNDARY_KEEP | 2026-08-31 | 85 | 0 | 1 |
| `liveRuntimeSessionDurableStore.ts` | LIVE_BOUNDARY_KEEP | 2026-08-31 | 88 | 1 | 5 |
| `liveSessionBrokerAdapterBoundary.ts` | LIVE_BOUNDARY_KEEP | 2026-08-31 | 85 | 1 | 0 |
| `liveSessionTransportChain.ts` | LIVE_BOUNDARY_KEEP | 2026-08-31 | 35 | 1 | 1 |
| `liveTransportContract.ts` | LIVE_BOUNDARY_KEEP | 2026-08-31 | 93 | 2 | 2 |
| `uxTelemetryComparison.ts` | UNREACHED_CHECK | 2026-08-31 | 86 | 1 | 0 |
| `uxTelemetryMetrics.ts` | UNREACHED_CHECK | 2026-08-31 | 106 | 2 | 1 |
| `canonicalPaperCandidatePerformanceSource.ts` | UNREACHED_CHECK | 2026-09-05 | 39 | 1 | 0 |
| `module10XS.ts` | UNREACHED_CHECK | 2026-09-10 | 112 | 2 | 2 |
| `moduleReplacementPolicy10XS.ts` | UNREACHED_CHECK | 2026-09-10 | 74 | 1 | 0 |
| `moduleRuntimeManifest10XS.ts` | UNREACHED_CHECK | 2026-09-10 | 84 | 1 | 2 |
| `reviewEngineV10.ts` | UNREACHED_CHECK | 2026-09-10 | 60 | 0 | 0 |
| `canonicalModuleRegistryV10.ts` | UNREACHED_CHECK | 2026-09-18 | 103 | 2 | 0 |
| `executionEngineV10.ts` | UNREACHED_CHECK | 2026-09-19 | 104 | 1 | 0 |
| `moduleLevel10.ts` | UNREACHED_CHECK | 2026-09-19 | 197 | 3 | 7 |
| `pipelineOrchestratorV10.ts` | UNREACHED_CHECK | 2026-09-19 | 118 | 1 | 0 |
| `pipelineRiskContractsV10.ts` | UNREACHED_CHECK | 2026-09-19 | 82 | 1 | 1 |
| `familyPortfolioRiskEvidence.ts` | UNREACHED_CHECK | 2026-09-20 | 200 | 1 | 0 |
| `paperPerformanceComparison.ts` | UNREACHED_CHECK | 2026-09-20 | 46 | 1 | 0 |
| `researchMemoryV2.ts` | UNREACHED_CHECK | 2026-09-20 | 197 | 2 | 0 |
| `candidatePromotionRuntime.ts` | UNREACHED_CHECK | 2026-09-21 | 183 | 5 | 0 |
| `strategyFamilyRegistry.ts` | UNREACHED_CHECK | 2026-09-21 | 142 | 3 | 0 |
| `strategyEvolutionAdvisory.ts` | PRODUCT_SURFACE_KEEP | 2026-09-26 | 328 | 1 | 1 |
| `paperPerformanceStatistics.ts` | UNREACHED_CHECK | 2026-09-28 | 65 | 1 | 0 |
| `canonicalPaperAccountSnapshotHistory.ts` | UNREACHED_CHECK | 2026-09-29 | 117 | 0 | 0 |
| `researchMarketWindow.ts` | UNREACHED_CHECK | 2026-10-02 | 38 | 1 | 0 |
| `consecutiveLossLimitComparison.ts` | UNREACHED_CHECK | 2026-10-13 | 90 | 1 | 0 |
| `researchRunValidation.ts` | PRODUCT_SURFACE_KEEP | 2026-10-16 | 210 | 7 | 2 |
| `researchCandleCollector.ts` | UNREACHED_CHECK | 2026-10-17 | 71 | 1 | 0 |
| `moduleQualificationV1.ts` | UNREACHED_CHECK | 2026-10-18 | 116 | 2 | 1 |

## Next step per module

For each row: name the owner and the reason it exists (planned capability, research-only, superseded, or dead), confirm with a runtime search that it is not loaded dynamically, then either keep it with a documented reason, move it behind an `attic/` boundary that build and required CI exclude, or delete it in a governed PR. Never on a guess; never evidence.
