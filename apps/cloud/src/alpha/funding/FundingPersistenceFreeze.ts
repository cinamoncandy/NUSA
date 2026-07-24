export const FUNDING_PERSISTENCE_ALPHA_FREEZE = Object.freeze({
  alphaId: "FUNDING_PERSISTENCE",
  version: 1,
  status: "FROZEN_FOR_RESEARCH_VALIDATION",
  modules: Object.freeze([
    "FundingPersistenceFeature",
    "FundingPersistenceStrategy",
    "FundingPersistenceBacktest",
    "FundingPersistenceWalkForward",
    "FundingPersistenceStress",
    "FundingPersistencePaper"
  ]),
  invariants: Object.freeze([
    "COMPLETED_DATA_ONLY",
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
    dataContractChangesRequireMigration: true
  })
} as const);

export type FundingPersistenceAlphaFreeze = typeof FUNDING_PERSISTENCE_ALPHA_FREEZE;
