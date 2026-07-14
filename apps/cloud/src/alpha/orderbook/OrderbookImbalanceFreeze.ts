export const ORDERBOOK_IMBALANCE_ALPHA_FREEZE = Object.freeze({
  alphaId: "ORDERBOOK_IMBALANCE",
  version: 1,
  status: "FROZEN_FOR_RESEARCH_VALIDATION",
  modules: Object.freeze([
    "OrderbookImbalanceFeature",
    "OrderbookImbalanceStrategy",
    "OrderbookImbalanceBacktest",
    "OrderbookImbalanceWalkForward",
    "OrderbookImbalanceStress",
    "OrderbookImbalancePaper"
  ]),
  invariants: Object.freeze([
    "CHRONOLOGICAL_SNAPSHOTS_ONLY",
    "NEXT_SNAPSHOT_EXECUTION",
    "DETERMINISTIC_REPLAY",
    "FAIL_CLOSED_VALIDATION",
    "NO_AUTOMATIC_PROMOTION",
    "PAPER_OR_DRY_RUN_ONLY",
    "NO_PRIVATE_EXCHANGE_API",
    "NO_CREDENTIAL_ACCESS",
    "NO_LIVE_ORDER_PATH"
  ]),
  changePolicy: Object.freeze({
    breakingChangesRequireVersionBump: true,
    safetyBoundaryRelaxationForbidden: true,
    metricSemanticChangesRequireAudit: true,
    dataContractChangesRequireMigration: true,
    executionModelChangesRequireRevalidation: true
  })
} as const);

export type OrderbookImbalanceAlphaFreeze = typeof ORDERBOOK_IMBALANCE_ALPHA_FREEZE;
