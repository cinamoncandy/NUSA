"use strict";
/**
 * Evidence invalidation matrix (WO-0037).
 *
 * Pure policy data plus lookups. Deliberately contains NO git access, NO file
 * classification, and NO risk-level arithmetic, so the analyzer and the independent
 * verifier can each consult the same declared policy while deriving everything else
 * separately.
 *
 * EVIDENCE AVAILABILITY DISCLOSURE. The evidence type names below are the full policy
 * vocabulary. Only some of them correspond to evidence that this repository can
 * actually produce today; the rest are forward-looking placeholders for work that has
 * not been implemented. `EVIDENCE_AVAILABILITY` records which is which, so nobody
 * reads this matrix as a claim that all of this evidence exists. Marking a
 * not-yet-produced evidence type as "invalidated" is meaningful policy (it says: if you
 * ever produce it, this change would have invalidated it), but it must never be read as
 * "this evidence existed and was checked".
 */

const CHANGE_CATEGORIES = Object.freeze([
  "DOCUMENTATION_ONLY", "UI_COPY_ONLY", "UI_LAYOUT", "DIAGNOSTICS", "LOGGING", "TEST_ONLY",
  "BUILD_PIPELINE", "PACKAGING", "INSTALLER", "DEPENDENCY",
  "MARKET_DATA", "CANDLE_CONTRACT",
  "STRATEGY", "STRATEGY_PARAMETER", "ORDER_SIZING",
  "RISK_POLICY", "CONTROL_PLANE", "KILL_SWITCH", "ALERTING",
  "PERSISTENCE", "SCHEMA_MIGRATION",
  "PAPER_BROKER", "ACCOUNTING", "RECONCILIATION",
  "EVIDENCE", "SECURITY_BOUNDARY", "UNKNOWN"
]);

const EVIDENCE_TYPES = Object.freeze([
  "DATASET_INTEGRITY", "BACKTEST", "COST_STRESS", "WALK_FORWARD", "PARAMETER_ROBUSTNESS",
  "REGIME_ANALYSIS", "CROSS_MARKET", "STRATEGY_SCORECARD",
  "RISK_GATEWAY", "SAFETY_DRILLS",
  "SHADOW_PILOT", "CANARY_PILOT", "EXTENDED_PAPER", "WINDOWS_GUI",
  "INSTALLER", "UPGRADE", "ROLLBACK", "ARTIFACT_INTEGRITY",
  "RELEASE_CANDIDATE", "INTERNAL_RELEASE"
]);

/**
 * Which evidence types this repository can actually produce as of this commit.
 * PRODUCIBLE  -- an implemented, tested runner exists that emits this evidence.
 * NOT_PRODUCED -- named by policy, but no implementation exists yet in this repository.
 */
const EVIDENCE_AVAILABILITY = Object.freeze({
  DATASET_INTEGRITY: "PRODUCIBLE",      // apps/desktop/src/researchDataset.ts
  BACKTEST: "PRODUCIBLE",               // apps/desktop/src/backtestEngine.ts
  COST_STRESS: "PRODUCIBLE",            // tests/execution-cost-stress.test.js
  WALK_FORWARD: "PRODUCIBLE",           // scripts/lib/walk-forward-runner.js (WO-0027)
  PARAMETER_ROBUSTNESS: "PRODUCIBLE",   // scripts/lib/parameter-robustness-runner.js (WO-0028)
  REGIME_ANALYSIS: "PRODUCIBLE",        // scripts/lib/regime-analysis-runner.js (WO-0029)
  CROSS_MARKET: "NOT_PRODUCED",
  STRATEGY_SCORECARD: "NOT_PRODUCED",
  RISK_GATEWAY: "NOT_PRODUCED",
  SAFETY_DRILLS: "NOT_PRODUCED",
  SHADOW_PILOT: "NOT_PRODUCED",
  CANARY_PILOT: "NOT_PRODUCED",
  EXTENDED_PAPER: "NOT_PRODUCED",
  WINDOWS_GUI: "NOT_PRODUCED",
  INSTALLER: "NOT_PRODUCED",
  UPGRADE: "NOT_PRODUCED",
  ROLLBACK: "NOT_PRODUCED",
  ARTIFACT_INTEGRITY: "NOT_PRODUCED",
  RELEASE_CANDIDATE: "NOT_PRODUCED",
  INTERNAL_RELEASE: "NOT_PRODUCED"
});

const RESEARCH_EVIDENCE = Object.freeze([
  "DATASET_INTEGRITY", "BACKTEST", "COST_STRESS", "WALK_FORWARD",
  "PARAMETER_ROBUSTNESS", "REGIME_ANALYSIS", "CROSS_MARKET", "STRATEGY_SCORECARD"
]);
const PAPER_EVIDENCE = Object.freeze(["SHADOW_PILOT", "CANARY_PILOT", "EXTENDED_PAPER"]);
const PACKAGE_EVIDENCE = Object.freeze(["INSTALLER", "UPGRADE", "ROLLBACK", "ARTIFACT_INTEGRITY", "WINDOWS_GUI"]);
const RELEASE_EVIDENCE = Object.freeze(["RELEASE_CANDIDATE", "INTERNAL_RELEASE"]);

/** Every category invalidates at least the release evidence, because any shipped change
 * produces a different artifact. Categories that ship nothing (docs, tests, CI) are the
 * explicit exceptions and are listed with their own narrower sets. */
const CATEGORY_INVALIDATES = Object.freeze({
  DOCUMENTATION_ONLY: Object.freeze([]),
  TEST_ONLY: Object.freeze([]),
  BUILD_PIPELINE: Object.freeze(["ARTIFACT_INTEGRITY", ...RELEASE_EVIDENCE]),

  UI_COPY_ONLY: Object.freeze(["WINDOWS_GUI", "ARTIFACT_INTEGRITY", ...RELEASE_EVIDENCE]),
  UI_LAYOUT: Object.freeze(["WINDOWS_GUI", "ARTIFACT_INTEGRITY", ...RELEASE_EVIDENCE]),
  DIAGNOSTICS: Object.freeze(["WINDOWS_GUI", "ARTIFACT_INTEGRITY", ...RELEASE_EVIDENCE]),
  LOGGING: Object.freeze(["WINDOWS_GUI", "ARTIFACT_INTEGRITY", ...RELEASE_EVIDENCE]),

  PACKAGING: Object.freeze([...PACKAGE_EVIDENCE, ...RELEASE_EVIDENCE]),
  INSTALLER: Object.freeze([...PACKAGE_EVIDENCE, ...RELEASE_EVIDENCE]),
  DEPENDENCY: Object.freeze([...PACKAGE_EVIDENCE, "SAFETY_DRILLS", ...RELEASE_EVIDENCE]),

  MARKET_DATA: Object.freeze([...RESEARCH_EVIDENCE, ...PAPER_EVIDENCE, ...RELEASE_EVIDENCE]),
  CANDLE_CONTRACT: Object.freeze([...RESEARCH_EVIDENCE, ...PAPER_EVIDENCE, ...RELEASE_EVIDENCE]),

  STRATEGY: Object.freeze([...RESEARCH_EVIDENCE, ...PAPER_EVIDENCE, ...RELEASE_EVIDENCE]),
  STRATEGY_PARAMETER: Object.freeze([...RESEARCH_EVIDENCE, ...PAPER_EVIDENCE, ...RELEASE_EVIDENCE]),
  ORDER_SIZING: Object.freeze(["BACKTEST", "COST_STRESS", "WALK_FORWARD", "PARAMETER_ROBUSTNESS", "REGIME_ANALYSIS", "CROSS_MARKET", "STRATEGY_SCORECARD", ...PAPER_EVIDENCE, ...RELEASE_EVIDENCE]),

  RISK_POLICY: Object.freeze(["RISK_GATEWAY", "SAFETY_DRILLS", "STRATEGY_SCORECARD", ...PAPER_EVIDENCE, ...RELEASE_EVIDENCE]),
  KILL_SWITCH: Object.freeze(["RISK_GATEWAY", "SAFETY_DRILLS", "STRATEGY_SCORECARD", ...PAPER_EVIDENCE, ...RELEASE_EVIDENCE]),
  CONTROL_PLANE: Object.freeze(["RISK_GATEWAY", "SAFETY_DRILLS", ...PAPER_EVIDENCE, ...RELEASE_EVIDENCE]),
  ALERTING: Object.freeze(["SAFETY_DRILLS", ...PAPER_EVIDENCE, ...RELEASE_EVIDENCE]),

  PERSISTENCE: Object.freeze(["SAFETY_DRILLS", "UPGRADE", "ROLLBACK", ...PAPER_EVIDENCE, ...RELEASE_EVIDENCE]),
  SCHEMA_MIGRATION: Object.freeze(["SAFETY_DRILLS", "UPGRADE", "ROLLBACK", ...PAPER_EVIDENCE, ...RELEASE_EVIDENCE]),

  // Fill and PnL arithmetic underpins every research number AND every ledger claim.
  PAPER_BROKER: Object.freeze([...RESEARCH_EVIDENCE, "SAFETY_DRILLS", ...PAPER_EVIDENCE, ...RELEASE_EVIDENCE]),
  ACCOUNTING: Object.freeze([...RESEARCH_EVIDENCE, "SAFETY_DRILLS", ...PAPER_EVIDENCE, ...RELEASE_EVIDENCE]),
  RECONCILIATION: Object.freeze(["SAFETY_DRILLS", ...PAPER_EVIDENCE, ...RELEASE_EVIDENCE]),

  EVIDENCE: Object.freeze(["ARTIFACT_INTEGRITY", ...RELEASE_EVIDENCE]),

  // A security-boundary change or an unclassifiable change invalidates everything:
  // fail-safe, never fail-open.
  SECURITY_BOUNDARY: Object.freeze([...EVIDENCE_TYPES]),
  UNKNOWN: Object.freeze([...EVIDENCE_TYPES])
});

const FINGERPRINT_TYPES = Object.freeze(["STRATEGY", "CONFIG", "RUNTIME", "RISK_POLICY"]);

const CATEGORY_INVALIDATES_FINGERPRINTS = Object.freeze({
  DOCUMENTATION_ONLY: Object.freeze([]),
  TEST_ONLY: Object.freeze([]),
  BUILD_PIPELINE: Object.freeze([]),

  UI_COPY_ONLY: Object.freeze(["RUNTIME"]),
  UI_LAYOUT: Object.freeze(["RUNTIME"]),
  DIAGNOSTICS: Object.freeze(["RUNTIME"]),
  LOGGING: Object.freeze(["RUNTIME"]),
  PACKAGING: Object.freeze(["RUNTIME"]),
  INSTALLER: Object.freeze(["RUNTIME"]),
  DEPENDENCY: Object.freeze(["RUNTIME"]),
  EVIDENCE: Object.freeze(["RUNTIME"]),

  MARKET_DATA: Object.freeze(["RUNTIME"]),
  CANDLE_CONTRACT: Object.freeze(["STRATEGY", "RUNTIME"]),

  STRATEGY: Object.freeze(["STRATEGY", "RUNTIME"]),
  STRATEGY_PARAMETER: Object.freeze(["STRATEGY", "RUNTIME"]),
  ORDER_SIZING: Object.freeze(["STRATEGY", "CONFIG", "RUNTIME"]),

  RISK_POLICY: Object.freeze(["CONFIG", "RISK_POLICY", "RUNTIME"]),
  KILL_SWITCH: Object.freeze(["CONFIG", "RISK_POLICY", "RUNTIME"]),
  CONTROL_PLANE: Object.freeze(["CONFIG", "RISK_POLICY", "RUNTIME"]),
  ALERTING: Object.freeze(["CONFIG", "RISK_POLICY", "RUNTIME"]),

  PERSISTENCE: Object.freeze(["RUNTIME"]),
  SCHEMA_MIGRATION: Object.freeze(["RUNTIME"]),
  PAPER_BROKER: Object.freeze(["RUNTIME"]),
  ACCOUNTING: Object.freeze(["RUNTIME"]),
  RECONCILIATION: Object.freeze(["RUNTIME"]),

  SECURITY_BOUNDARY: Object.freeze([...FINGERPRINT_TYPES]),
  UNKNOWN: Object.freeze([...FINGERPRINT_TYPES])
});

/** Base risk level per category. UNKNOWN is deliberately high, never low. */
const CATEGORY_RISK_LEVEL = Object.freeze({
  DOCUMENTATION_ONLY: 0,
  UI_COPY_ONLY: 1, UI_LAYOUT: 1, DIAGNOSTICS: 1, LOGGING: 1, TEST_ONLY: 1,
  BUILD_PIPELINE: 2, PACKAGING: 2, INSTALLER: 2, DEPENDENCY: 2, EVIDENCE: 2,
  MARKET_DATA: 3, CANDLE_CONTRACT: 3, CONTROL_PLANE: 3, ALERTING: 3,
  PERSISTENCE: 3, SCHEMA_MIGRATION: 3,
  STRATEGY: 4, STRATEGY_PARAMETER: 4, ORDER_SIZING: 4,
  RISK_POLICY: 4, KILL_SWITCH: 4,
  PAPER_BROKER: 4, ACCOUNTING: 4, RECONCILIATION: 4,
  SECURITY_BOUNDARY: 4,
  UNKNOWN: 4
});

const PAPER_STAGES = Object.freeze([
  "UNIT_ONLY", "FULL_CI", "PACKAGE_SMOKE", "WINDOWS_GUI_ACCEPTANCE",
  "OFFLINE_SAFETY_PREFLIGHT", "SHADOW", "MANUAL_PAPER", "CANARY_PAPER",
  "EXTENDED_PAPER", "NEW_RELEASE_CANDIDATE", "INTERNAL_RELEASE_STABILIZATION",
  "FULL_RESEARCH_PIPELINE"
]);

/** Canonical stage ordering so a plan is always reported in execution order. */
const STAGE_ORDER = Object.freeze(Object.fromEntries(PAPER_STAGES.map((stage, index) => [stage, index])));

const CATEGORY_REQUIRED_STAGES = Object.freeze({
  DOCUMENTATION_ONLY: Object.freeze(["UNIT_ONLY"]),
  TEST_ONLY: Object.freeze(["FULL_CI"]),
  BUILD_PIPELINE: Object.freeze(["FULL_CI", "PACKAGE_SMOKE", "NEW_RELEASE_CANDIDATE"]),

  UI_COPY_ONLY: Object.freeze(["FULL_CI", "PACKAGE_SMOKE", "WINDOWS_GUI_ACCEPTANCE", "NEW_RELEASE_CANDIDATE"]),
  UI_LAYOUT: Object.freeze(["FULL_CI", "PACKAGE_SMOKE", "WINDOWS_GUI_ACCEPTANCE", "NEW_RELEASE_CANDIDATE"]),
  DIAGNOSTICS: Object.freeze(["FULL_CI", "PACKAGE_SMOKE", "WINDOWS_GUI_ACCEPTANCE", "NEW_RELEASE_CANDIDATE"]),
  LOGGING: Object.freeze(["FULL_CI", "PACKAGE_SMOKE", "WINDOWS_GUI_ACCEPTANCE", "NEW_RELEASE_CANDIDATE"]),
  EVIDENCE: Object.freeze(["FULL_CI", "PACKAGE_SMOKE", "NEW_RELEASE_CANDIDATE"]),

  PACKAGING: Object.freeze(["FULL_CI", "PACKAGE_SMOKE", "WINDOWS_GUI_ACCEPTANCE", "NEW_RELEASE_CANDIDATE", "INTERNAL_RELEASE_STABILIZATION"]),
  INSTALLER: Object.freeze(["FULL_CI", "PACKAGE_SMOKE", "WINDOWS_GUI_ACCEPTANCE", "NEW_RELEASE_CANDIDATE", "INTERNAL_RELEASE_STABILIZATION"]),
  DEPENDENCY: Object.freeze(["FULL_CI", "PACKAGE_SMOKE", "WINDOWS_GUI_ACCEPTANCE", "OFFLINE_SAFETY_PREFLIGHT", "NEW_RELEASE_CANDIDATE", "INTERNAL_RELEASE_STABILIZATION"]),

  MARKET_DATA: Object.freeze(["FULL_CI", "OFFLINE_SAFETY_PREFLIGHT", "SHADOW", "MANUAL_PAPER", "CANARY_PAPER", "NEW_RELEASE_CANDIDATE"]),
  CANDLE_CONTRACT: Object.freeze(["FULL_CI", "FULL_RESEARCH_PIPELINE", "OFFLINE_SAFETY_PREFLIGHT", "SHADOW", "CANARY_PAPER", "NEW_RELEASE_CANDIDATE"]),

  STRATEGY: Object.freeze(["FULL_CI", "FULL_RESEARCH_PIPELINE", "SHADOW", "CANARY_PAPER", "EXTENDED_PAPER", "NEW_RELEASE_CANDIDATE"]),
  STRATEGY_PARAMETER: Object.freeze(["FULL_CI", "FULL_RESEARCH_PIPELINE", "SHADOW", "CANARY_PAPER", "EXTENDED_PAPER", "NEW_RELEASE_CANDIDATE"]),
  ORDER_SIZING: Object.freeze(["FULL_CI", "FULL_RESEARCH_PIPELINE", "OFFLINE_SAFETY_PREFLIGHT", "SHADOW", "CANARY_PAPER", "EXTENDED_PAPER", "NEW_RELEASE_CANDIDATE"]),

  RISK_POLICY: Object.freeze(["FULL_CI", "OFFLINE_SAFETY_PREFLIGHT", "SHADOW", "MANUAL_PAPER", "CANARY_PAPER", "EXTENDED_PAPER", "NEW_RELEASE_CANDIDATE"]),
  KILL_SWITCH: Object.freeze(["FULL_CI", "OFFLINE_SAFETY_PREFLIGHT", "SHADOW", "MANUAL_PAPER", "CANARY_PAPER", "EXTENDED_PAPER", "NEW_RELEASE_CANDIDATE"]),
  CONTROL_PLANE: Object.freeze(["FULL_CI", "OFFLINE_SAFETY_PREFLIGHT", "MANUAL_PAPER", "CANARY_PAPER", "NEW_RELEASE_CANDIDATE"]),
  ALERTING: Object.freeze(["FULL_CI", "OFFLINE_SAFETY_PREFLIGHT", "MANUAL_PAPER", "CANARY_PAPER", "NEW_RELEASE_CANDIDATE"]),

  PERSISTENCE: Object.freeze(["FULL_CI", "OFFLINE_SAFETY_PREFLIGHT", "MANUAL_PAPER", "CANARY_PAPER", "EXTENDED_PAPER", "NEW_RELEASE_CANDIDATE"]),
  SCHEMA_MIGRATION: Object.freeze(["FULL_CI", "OFFLINE_SAFETY_PREFLIGHT", "MANUAL_PAPER", "CANARY_PAPER", "EXTENDED_PAPER", "NEW_RELEASE_CANDIDATE"]),

  PAPER_BROKER: Object.freeze(["FULL_CI", "FULL_RESEARCH_PIPELINE", "OFFLINE_SAFETY_PREFLIGHT", "MANUAL_PAPER", "CANARY_PAPER", "EXTENDED_PAPER", "NEW_RELEASE_CANDIDATE"]),
  ACCOUNTING: Object.freeze(["FULL_CI", "FULL_RESEARCH_PIPELINE", "OFFLINE_SAFETY_PREFLIGHT", "MANUAL_PAPER", "CANARY_PAPER", "EXTENDED_PAPER", "NEW_RELEASE_CANDIDATE"]),
  RECONCILIATION: Object.freeze(["FULL_CI", "OFFLINE_SAFETY_PREFLIGHT", "MANUAL_PAPER", "CANARY_PAPER", "EXTENDED_PAPER", "NEW_RELEASE_CANDIDATE"]),

  SECURITY_BOUNDARY: Object.freeze([...PAPER_STAGES].filter((stage) => stage !== "UNIT_ONLY")),
  UNKNOWN: Object.freeze([...PAPER_STAGES].filter((stage) => stage !== "UNIT_ONLY"))
});

const APPROVAL_BY_RISK_LEVEL = Object.freeze({
  0: Object.freeze(["MAINTAINER"]),
  1: Object.freeze(["MAINTAINER", "TEST_RESULTS"]),
  2: Object.freeze(["MAINTAINER", "TEST_RESULTS", "RELEASE_OWNER"]),
  3: Object.freeze(["MAINTAINER", "TEST_RESULTS", "OWNER", "SAFETY_REVIEWER"]),
  4: Object.freeze(["MAINTAINER", "TEST_RESULTS", "OWNER", "SAFETY_REVIEWER", "FULL_REVALIDATION_PLAN"]),
  5: Object.freeze([])
});

function invalidatedEvidenceFor(categories) {
  const set = new Set();
  for (const category of categories) for (const evidence of CATEGORY_INVALIDATES[category] ?? CATEGORY_INVALIDATES.UNKNOWN) set.add(evidence);
  return EVIDENCE_TYPES.filter((evidence) => set.has(evidence));
}

function invalidatedFingerprintsFor(categories) {
  const set = new Set();
  for (const category of categories) for (const fingerprint of CATEGORY_INVALIDATES_FINGERPRINTS[category] ?? CATEGORY_INVALIDATES_FINGERPRINTS.UNKNOWN) set.add(fingerprint);
  return FINGERPRINT_TYPES.filter((fingerprint) => set.has(fingerprint));
}

function requiredStagesFor(categories) {
  const set = new Set();
  for (const category of categories) for (const stage of CATEGORY_REQUIRED_STAGES[category] ?? CATEGORY_REQUIRED_STAGES.UNKNOWN) set.add(stage);
  // A plan that includes any stage beyond UNIT_ONLY does not also need UNIT_ONLY,
  // which is subsumed by FULL_CI.
  if (set.size > 1) set.delete("UNIT_ONLY");
  return [...set].sort((a, b) => STAGE_ORDER[a] - STAGE_ORDER[b]);
}

function riskLevelFor(categories) {
  let level = 0;
  for (const category of categories) level = Math.max(level, CATEGORY_RISK_LEVEL[category] ?? CATEGORY_RISK_LEVEL.UNKNOWN);
  return level;
}

function approvalsFor(riskLevel) {
  return [...(APPROVAL_BY_RISK_LEVEL[riskLevel] ?? [])];
}

function retainedEvidenceFor(invalidated) {
  const set = new Set(invalidated);
  return EVIDENCE_TYPES.filter((evidence) => !set.has(evidence));
}

module.exports = {
  CHANGE_CATEGORIES, EVIDENCE_TYPES, EVIDENCE_AVAILABILITY, FINGERPRINT_TYPES, PAPER_STAGES,
  CATEGORY_INVALIDATES, CATEGORY_INVALIDATES_FINGERPRINTS, CATEGORY_RISK_LEVEL,
  CATEGORY_REQUIRED_STAGES, APPROVAL_BY_RISK_LEVEL,
  invalidatedEvidenceFor, invalidatedFingerprintsFor, requiredStagesFor, riskLevelFor,
  approvalsFor, retainedEvidenceFor
};
