/**
 * Where each module named by `platformTopology.ts` actually lives.
 *
 * `validatePlatformTopology` checks the topology literal against itself -- unique ids, known
 * dependency ids, allowed layer pairs, real-time flags -- and never asks whether the modules it
 * names exist. A map that cannot be wrong about the tree is a diagram, not a contract, and it is
 * the same failure `alphaReadiness.ts` and `pipelineWiringV10.ts` guard one layer down: a
 * declaration that keeps reading correct while the thing it describes drifts or was never built.
 *
 * Two entries are worth reading before the rest. `polymarket` is declared a real-time PLUGIN
 * responsible for "prediction market alpha", and the only file bearing the name is a contract in
 * `packages/contracts`: there is no implementation. `funding-carry` is declared the same way and
 * is built, but unfeedable on this venue -- nothing in the tree fetches a funding rate and Upbit
 * KRW is spot-only, so its input does not exist (ADR-0025, `alphaReadiness.ts`). Both sit in the
 * real-time path on paper and in neither in fact.
 *
 * Paths are anchors, not inventories: one or two files that could not plausibly exist if the
 * module did not. `tests/platform-topology-implementations.test.js` checks that every module has
 * an entry, that every path resolves, and that a module claiming IMPLEMENTED names at least one.
 */

export type ModuleImplementationStatus =
  /** Built and present in the tree at the paths below. */
  | "IMPLEMENTED"
  /** Only a contract or type declaration exists; no implementation was found. */
  | "CONTRACT_ONLY";

export interface ModuleImplementation {
  readonly moduleId: string;
  readonly status: ModuleImplementationStatus;
  /** Repo-relative anchors. A file or a directory; every entry must exist. */
  readonly paths: readonly string[];
  /** Required when the status is not IMPLEMENTED. What is missing, and why it matters. */
  readonly note: string;
}

export const TOPOLOGY_IMPLEMENTATIONS: readonly ModuleImplementation[] = Object.freeze([
  Object.freeze({ moduleId: "market", status: "IMPLEMENTED", paths: Object.freeze(["packages/core/src/upbitWebSocket.ts", "apps/cloud/src/marketStateEngine.ts"]), note: "" }),
  Object.freeze({ moduleId: "probability", status: "IMPLEMENTED", paths: Object.freeze(["apps/cloud/src/probabilityEngine.ts", "apps/cloud/src/probabilityEdgeEngine.ts"]), note: "" }),
  Object.freeze({ moduleId: "alpha", status: "IMPLEMENTED", paths: Object.freeze(["apps/cloud/src/alpha", "apps/cloud/src/alpha/alphaReadiness.ts"]), note: "" }),
  Object.freeze({ moduleId: "portfolio", status: "IMPLEMENTED", paths: Object.freeze(["apps/cloud/src/capitalAllocationEngine.ts", "apps/cloud/src/portfolioEngineV10.ts"]), note: "" }),
  Object.freeze({ moduleId: "risk", status: "IMPLEMENTED", paths: Object.freeze(["packages/core/src/independentRiskGateway.ts", "apps/cloud/src/cloudPaperCanonicalRiskGateway.ts"]), note: "" }),
  Object.freeze({ moduleId: "execution", status: "IMPLEMENTED", paths: Object.freeze(["apps/cloud/src/cloudPaperExecutionBoundary.ts", "apps/cloud/src/executionEngineV10.ts"]), note: "" }),
  Object.freeze({ moduleId: "runtime", status: "IMPLEMENTED", paths: Object.freeze(["apps/cloud/src/runtime.ts", "apps/cloud/src/runtimeReplay.ts"]), note: "" }),

  Object.freeze({ moduleId: "research", status: "IMPLEMENTED", paths: Object.freeze(["apps/cloud/src/researchAutomationRuntime.ts", "apps/cloud/src/researchBacklog.ts"]), note: "" }),
  Object.freeze({ moduleId: "validation", status: "IMPLEMENTED", paths: Object.freeze(["apps/cloud/src/researchRunValidation.ts", "apps/cloud/src/paperValidationEvidence.ts"]), note: "" }),
  Object.freeze({ moduleId: "committee", status: "IMPLEMENTED", paths: Object.freeze(["apps/cloud/src/investmentCommittee.ts", "apps/cloud/src/investmentCommitteeLedger.ts"]), note: "" }),
  Object.freeze({ moduleId: "governance", status: "IMPLEMENTED", paths: Object.freeze(["apps/cloud/src/strategyGovernanceService.ts", "apps/cloud/src/strategyGovernanceLedger.ts"]), note: "" }),
  Object.freeze({ moduleId: "release", status: "IMPLEMENTED", paths: Object.freeze(["apps/cloud/src/releaseReadinessAudit.ts", "apps/cloud/src/releaseEvidenceAuthority.ts"]), note: "" }),

  Object.freeze({ moduleId: "operations-recorder", status: "IMPLEMENTED", paths: Object.freeze(["apps/cloud/src/paperScenarioEvidenceRecorder.ts", "apps/cloud/src/controlAuditLedger.ts"]), note: "" }),
  Object.freeze({ moduleId: "operations-replay", status: "IMPLEMENTED", paths: Object.freeze(["apps/cloud/src/runtimeReplay.ts", "apps/cloud/src/closedLearningLineageReplayInputSource.ts"]), note: "" }),
  Object.freeze({ moduleId: "operations-audit", status: "IMPLEMENTED", paths: Object.freeze(["apps/cloud/src/architectureAudit.ts", "apps/cloud/src/runtimeIncidentReport.ts"]), note: "" }),
  Object.freeze({ moduleId: "operations-evidence", status: "IMPLEMENTED", paths: Object.freeze(["apps/cloud/src/operatorEvidenceBundle.ts", "apps/cloud/src/complianceReport.ts"]), note: "" }),
  Object.freeze({ moduleId: "operations-monitoring", status: "IMPLEMENTED", paths: Object.freeze(["apps/cloud/src/paperLearningObservability.ts", "apps/cloud/src/edgeDecayMonitor.ts"]), note: "" }),

  Object.freeze({
    moduleId: "funding-carry",
    status: "IMPLEMENTED",
    paths: Object.freeze(["apps/cloud/src/alpha/funding", "apps/cloud/src/alpha/funding/FundingPersistencePaper.ts"]),
    note: ""
  }),
  Object.freeze({
    moduleId: "polymarket",
    status: "CONTRACT_ONLY",
    paths: Object.freeze(["packages/contracts/src/polymarketResearchEvidence.ts"]),
    note:
      "Declared a real-time PLUGIN responsible for prediction market alpha, but only an evidence " +
      "contract exists -- no adapter, no data source, nothing that could produce a signal. It " +
      "cannot be part of any real-time path until something implements it."
  }),

  Object.freeze({ moduleId: "desktop", status: "IMPLEMENTED", paths: Object.freeze(["apps/desktop/src/main.ts"]), note: "" }),
  Object.freeze({ moduleId: "mobile", status: "IMPLEMENTED", paths: Object.freeze(["apps/mobile/App.tsx", "apps/mobile/src/instrumentState.ts"]), note: "" })
]);

/** Modules the topology names that no implementation backs. */
export function modulesWithoutImplementation(): readonly ModuleImplementation[] {
  return TOPOLOGY_IMPLEMENTATIONS.filter(entry => entry.status !== "IMPLEMENTED");
}
