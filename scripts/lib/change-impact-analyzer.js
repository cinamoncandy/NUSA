"use strict";
/**
 * Change impact analyzer (WO-0037).
 *
 * Answers: "what does this change make untrustworthy, and where must revalidation
 * restart?" Operates on a CHANGE SET -- an array of {path, status, addedLines,
 * removedLines} -- rather than requiring a live git repository, so the classification
 * and semantic rules are testable from fixtures. scripts/analyze-change-impact.js
 * produces that change set from a real `git diff`.
 *
 * Two hard design rules, both fail-safe:
 *   1. An unrecognised path is UNKNOWN, and UNKNOWN carries a HIGH risk level -- never
 *      a low one. A file nobody classified is treated as dangerous, not as harmless.
 *   2. Path is only the first signal. A semantic scan of the added/removed lines can
 *      ESCALATE a change (a numeric risk-limit edit inside a file that looks like
 *      config, a live-trading endpoint inside a file that looks like UI), but it can
 *      never de-escalate one.
 */
const { canonicalHash } = require("./canonical-hash.js");
const matrix = require("./evidence-invalidation-matrix.js");

const RISK_LEVEL_NAMES = Object.freeze(["LEVEL_0", "LEVEL_1", "LEVEL_2", "LEVEL_3", "LEVEL_4", "LEVEL_5"]);

/** Ordered path rules. First match wins, so the most specific patterns come first. */
const PATH_RULES = Object.freeze([
  { pattern: /^docs\//, category: "DOCUMENTATION_ONLY" },
  { pattern: /^(README|AGENTS|DOKKAEBI|CHANGELOG)[^/]*$/i, category: "DOCUMENTATION_ONLY" },
  { pattern: /^tests\//, category: "TEST_ONLY" },
  { pattern: /^\.github\/workflows\//, category: "BUILD_PIPELINE" },
  // Repository tooling (research runners, verifiers, validators). These generate and
  // check evidence but are not part of the shipped Electron runtime, so they are
  // classified as EVIDENCE rather than left UNKNOWN. They still cannot silently carry
  // a production behaviour change: see SHIPPING_PATH below.
  { pattern: /^scripts\//, category: "EVIDENCE" },
  { pattern: /(electron-builder|nsis|installer)/i, category: "INSTALLER" },
  { pattern: /^(package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/, category: "DEPENDENCY" },
  { pattern: /(paperBroker|paper-broker)/i, category: "PAPER_BROKER" },
  { pattern: /(ledger|accounting|pnl|fee)/i, category: "ACCOUNTING" },
  { pattern: /reconcil/i, category: "RECONCILIATION" },
  { pattern: /(strategyEngine|strategy-engine)/i, category: "STRATEGY" },
  { pattern: /(riskGateway|risk-gateway|riskPolicy|risk-policy|riskEngine)/i, category: "RISK_POLICY" },
  { pattern: /(killSwitch|kill-switch)/i, category: "KILL_SWITCH" },
  { pattern: /(controlPlane|control-plane|runtimeCommand)/i, category: "CONTROL_PLANE" },
  { pattern: /(alert|incident)/i, category: "ALERTING" },
  { pattern: /(migration|schema)/i, category: "SCHEMA_MIGRATION" },
  { pattern: /(sqlite|persistence|repository|storage|database)/i, category: "PERSISTENCE" },
  { pattern: /(marketCandle|candleBuilder|candle)/i, category: "CANDLE_CONTRACT" },
  { pattern: /(upbit|websocket|marketData|market-data|ticker)/i, category: "MARKET_DATA" },
  { pattern: /(evidence|manifest)/i, category: "EVIDENCE" },
  { pattern: /(preload|ipc|security)/i, category: "SECURITY_BOUNDARY" },
  { pattern: /(diagnostic|healthCheck)/i, category: "DIAGNOSTICS" },
  { pattern: /(logger|logging)/i, category: "LOGGING" },
  { pattern: /\.(css|scss)$/i, category: "UI_LAYOUT" },
  { pattern: /^apps\/[^/]+\/(renderer|ui|web)\//i, category: "UI_LAYOUT" },
  { pattern: /(renderer|\.html)$/i, category: "UI_LAYOUT" }
]);

function classifyPath(filePath) {
  for (const rule of PATH_RULES) {
    if (rule.pattern.test(filePath)) return rule.category;
  }
  return "UNKNOWN";
}

/**
 * Paths whose contents actually ship inside the Electron runtime. A production-behaviour
 * token (an SMA period, a risk limit, a fee formula) only means "production changed"
 * when it appears here. The same token inside tests/, scripts/, or docs/ is fixture or
 * tooling data and must not be escalated as a production edit -- otherwise every commit
 * grades LEVEL_4, the gate becomes noise, and people learn to ignore it, which is worse
 * than no gate at all.
 *
 * SECURITY RULES ARE DELIBERATELY EXEMPT FROM THIS SCOPING (see `global: true` below):
 * a credential or a live-order endpoint is a repository-wide problem no matter which
 * directory it lands in.
 */
const SHIPPING_PATH = /^(apps|packages)\//;

function shipsInRuntime(filePath) {
  return SHIPPING_PATH.test(filePath);
}

/**
 * Semantic rules over changed lines. `escalateTo` is a MINIMUM risk level the finding
 * forces; `addCategories` folds extra categories into the change so their evidence
 * invalidation applies even when the file path suggested something tamer.
 * `global: true` marks a rule that applies regardless of whether the file ships.
 */
const SEMANTIC_RULES = Object.freeze([
  { global: true, id: "LIVE_TRADING_CAPABILITY", pattern: /\b(liveTrading|LIVE_TRADING|realOrder|placeOrder|submitOrder)\b/, escalateTo: 5, addCategories: ["SECURITY_BOUNDARY"], side: "added" },
  { global: true, id: "PRIVATE_API_ENDPOINT", pattern: /(api\.upbit\.com\/v1\/(orders|accounts|withdraws|deposits)|privateApi|private_api)/i, escalateTo: 5, addCategories: ["SECURITY_BOUNDARY"], side: "added" },
  { global: true, id: "CREDENTIAL_FIELD", pattern: /\b(accessKey|secretKey|apiKey|api_secret|privateKey|credential|jwtSecret)\b/i, escalateTo: 5, addCategories: ["SECURITY_BOUNDARY"], side: "added" },

  { id: "STRATEGY_PARAMETER_CHANGE", pattern: /\b(shortWindow|longWindow|shortPeriod|longPeriod)\b\s*[:=]/, escalateTo: 4, addCategories: ["STRATEGY_PARAMETER"], side: "both" },
  { id: "TIMEFRAME_CHANGE", pattern: /\b(timeframeMs|timeframe|interval)\b\s*[:=]/, escalateTo: 4, addCategories: ["CANDLE_CONTRACT"], side: "both" },
  { id: "ORDER_SIZING_CHANGE", pattern: /\b(orderQuantity|orderSize|positionSize|notionalPerOrder)\b\s*[:=]/, escalateTo: 4, addCategories: ["ORDER_SIZING"], side: "both" },
  { id: "RISK_LIMIT_CHANGE", pattern: /\b(maxOrderNotional|maxPosition\w*|dailyLossLimit|consecutiveLossLimit|maxRealizedLoss|rateLimit)\b\s*[:=]/, escalateTo: 4, addCategories: ["RISK_POLICY"], side: "both" },
  { id: "ACCOUNTING_FORMULA_CHANGE", pattern: /\b(averagePrice|realizedPnl|feeRate|weightedAverage)\b\s*[:=]/, escalateTo: 4, addCategories: ["ACCOUNTING"], side: "both" },
  { id: "KILL_SWITCH_CONDITION_CHANGE", pattern: /\b(killSwitch|failClosed|emergencyStop)\b/i, escalateTo: 4, addCategories: ["KILL_SWITCH"], side: "both" },
  { id: "AUTOMATIC_RESTART_POLICY_CHANGE", pattern: /\b(autoTradeEnabled|automaticRestart|autoStart|restoreAutoTrade)\b\s*[:=]/, escalateTo: 4, addCategories: ["CONTROL_PLANE"], side: "both" },
  { global: true, id: "NEW_IPC_ORDER_PATH", pattern: /ipcMain\.(handle|on)\(\s*["'][^"']*(order|trade|execute)/i, escalateTo: 4, addCategories: ["SECURITY_BOUNDARY"], side: "added" },

  { id: "STALE_THRESHOLD_CHANGE", pattern: /\b(staleThreshold|staleAfterMs|maxStaleMs)\b\s*[:=]/, escalateTo: 3, addCategories: ["CONTROL_PLANE"], side: "both" },
  { id: "WARM_UP_CHANGE", pattern: /\b(warmUp|warmupCandles|reconnectWarmUp)\b\s*[:=]/, escalateTo: 3, addCategories: ["CONTROL_PLANE"], side: "both" },
  { id: "APPROVAL_EXPIRY_CHANGE", pattern: /\b(approvalExpiresAt|expiresAt|approvalTtl)\b\s*[:=]/, escalateTo: 3, addCategories: ["CONTROL_PLANE"], side: "both" },
  { id: "PERSISTENCE_TRANSACTION_CHANGE", pattern: /\b(BEGIN TRANSACTION|COMMIT|ROLLBACK|savepoint)\b/i, escalateTo: 3, addCategories: ["PERSISTENCE"], side: "both" },
  { global: true, id: "ENVIRONMENT_VARIABLE_ADDED", pattern: /process\.env\.[A-Z_]+/, escalateTo: 2, addCategories: [], side: "added" },

  { global: true, id: "TEST_SKIP_ADDED", pattern: /\b(test|it|describe)\.(skip|todo)\b|\bskip\s*:\s*true\b/, escalateTo: 3, addCategories: [], side: "added" },
  { global: true, id: "TEST_ASSERTION_REMOVED", pattern: /\bassert\b/, escalateTo: 2, addCategories: [], side: "removedOnly" }
]);

/** Acceptance-threshold relaxation: a NUMBER that got smaller on a minimum-* policy key
 * (or larger on a maximum-* key) is a weakening of the gate and is treated as LEVEL_4,
 * because it silently buys a pass rather than earning one. */
const MINIMUM_KEY = /\b(minimum[A-Za-z]*|minCalendarDays|minSessions|minOrders)\b\s*[:=]\s*(-?\d+(?:\.\d+)?)/g;
const MAXIMUM_KEY = /\b(maxOrderNotional|maxPosition[A-Za-z]*|dailyLossLimit|consecutiveLossLimit|maximum[A-Za-z]*)\b\s*[:=]\s*(-?\d+(?:\.\d+)?)/g;

function collectNumericAssignments(lines, regex) {
  const found = new Map();
  for (const line of lines) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(line)) !== null) found.set(match[1], Number(match[2]));
  }
  return found;
}

function detectPolicyRelaxation(addedLines, removedLines) {
  const findings = [];
  const addedMinimums = collectNumericAssignments(addedLines, MINIMUM_KEY);
  const removedMinimums = collectNumericAssignments(removedLines, MINIMUM_KEY);
  for (const [key, addedValue] of addedMinimums) {
    const removedValue = removedMinimums.get(key);
    if (removedValue != null && addedValue < removedValue) {
      findings.push({ id: "ACCEPTANCE_MINIMUM_REDUCED", detail: `${key}: ${removedValue} -> ${addedValue}`, escalateTo: 4, addCategories: ["RISK_POLICY"] });
    }
  }
  const addedMaximums = collectNumericAssignments(addedLines, MAXIMUM_KEY);
  const removedMaximums = collectNumericAssignments(removedLines, MAXIMUM_KEY);
  for (const [key, addedValue] of addedMaximums) {
    const removedValue = removedMaximums.get(key);
    if (removedValue != null && addedValue > removedValue) {
      findings.push({ id: "RISK_LIMIT_INCREASED", detail: `${key}: ${removedValue} -> ${addedValue}`, escalateTo: 4, addCategories: ["RISK_POLICY"] });
    }
    if (removedValue != null && addedValue < removedValue) {
      // Tightening is still a change (fingerprints move, regression still required),
      // but it is not a relaxation and is reported as such rather than as a risk event.
      findings.push({ id: "RISK_LIMIT_TIGHTENED", detail: `${key}: ${removedValue} -> ${addedValue}`, escalateTo: 4, addCategories: ["RISK_POLICY"], tightening: true });
    }
  }
  return findings;
}

function scanSemantics(changedFiles) {
  const findings = [];
  for (const file of changedFiles) {
    const added = file.addedLines ?? [];
    const removed = file.removedLines ?? [];
    const ships = shipsInRuntime(file.path);
    for (const rule of SEMANTIC_RULES) {
      // Production-behaviour rules only mean "production changed" inside shipping
      // paths. Security rules (global) apply everywhere.
      if (!rule.global && !ships) continue;
      let hit = false;
      if (rule.side === "added") hit = added.some((line) => rule.pattern.test(line));
      else if (rule.side === "removedOnly") {
        const removedHits = removed.filter((line) => rule.pattern.test(line)).length;
        const addedHits = added.filter((line) => rule.pattern.test(line)).length;
        hit = removedHits > addedHits;
      } else hit = added.some((line) => rule.pattern.test(line)) || removed.some((line) => rule.pattern.test(line));
      if (hit) findings.push({ id: rule.id, path: file.path, escalateTo: rule.escalateTo, addCategories: [...rule.addCategories] });
    }
    // A policy-threshold relaxation counts wherever the policy actually lives: in a
    // shipping path, or in a declared policy/config file anywhere in the tree.
    if (ships || /(policy|config|contract)/i.test(file.path)) {
      for (const relaxation of detectPolicyRelaxation(added, removed)) {
        findings.push({ ...relaxation, path: file.path });
      }
    }
  }
  return findings;
}

function validateChangeSet(changeSet) {
  const errors = [];
  if (changeSet == null || typeof changeSet !== "object") { errors.push("changeSet must be an object"); return errors; }
  if (changeSet.schemaVersion !== 1) errors.push(`unsupported schemaVersion: ${changeSet.schemaVersion}`);
  if (typeof changeSet.changeId !== "string" || changeSet.changeId.length === 0) errors.push("changeSet.changeId must be a non-empty string");
  if (typeof changeSet.baselineCommitSha !== "string" || changeSet.baselineCommitSha.length === 0) errors.push("changeSet.baselineCommitSha must be a non-empty string");
  if (typeof changeSet.targetCommitSha !== "string" || changeSet.targetCommitSha.length === 0) errors.push("changeSet.targetCommitSha must be a non-empty string");
  if (!Array.isArray(changeSet.changedFiles) || changeSet.changedFiles.length === 0) {
    errors.push("changeSet.changedFiles must be a non-empty array");
  } else {
    for (const file of changeSet.changedFiles) {
      if (typeof file?.path !== "string" || file.path.length === 0) { errors.push("every changed file needs a non-empty path"); continue; }
      if (!["ADDED", "MODIFIED", "DELETED", "RENAMED"].includes(file.status)) errors.push(`changed file ${file.path} has an invalid status: ${file.status}`);
      if (file.addedLines !== undefined && !Array.isArray(file.addedLines)) errors.push(`changed file ${file.path}: addedLines must be an array when present`);
      if (file.removedLines !== undefined && !Array.isArray(file.removedLines)) errors.push(`changed file ${file.path}: removedLines must be an array when present`);
    }
  }
  if (changeSet.changeRequest == null || typeof changeSet.changeRequest !== "object") {
    errors.push("changeSet.changeRequest is required -- every change needs one, including an emergency hotfix");
  } else {
    const request = changeSet.changeRequest;
    for (const key of ["changeId", "title", "reason", "requestedBy", "rollbackPlan"]) {
      if (typeof request[key] !== "string" || request[key].length === 0) errors.push(`changeRequest.${key} must be a non-empty string`);
    }
    if (request.emergency !== undefined && typeof request.emergency !== "boolean") errors.push("changeRequest.emergency must be a boolean when present");
    if (request.emergency === true && typeof request.rollbackConsidered !== "boolean") {
      errors.push("an emergency changeRequest must record rollbackConsidered (rollback is evaluated before a hotfix)");
    }
  }
  return errors;
}

function analyzeChangeImpact(changeSet) {
  const validationErrors = validateChangeSet(changeSet);
  if (validationErrors.length > 0) {
    return {
      schemaVersion: 1, changeId: changeSet && changeSet.changeId, status: "FAIL",
      changedFiles: [], categories: [], riskLevel: null, semanticFindings: [],
      invalidatedFingerprints: [], invalidatedEvidence: [], retainedEvidence: [],
      requiredStages: [], requiredApprovals: [], changeDecision: "INVALID",
      blockers: validationErrors, warnings: [], hashes: null
    };
  }

  const changedFiles = changeSet.changedFiles.map((file) => ({
    path: file.path,
    status: file.status,
    pathCategory: classifyPath(file.path),
    addedLineCount: (file.addedLines ?? []).length,
    removedLineCount: (file.removedLines ?? []).length
  }));

  const semanticFindings = scanSemantics(changeSet.changedFiles);

  const categorySet = new Set(changedFiles.map((file) => file.pathCategory));
  for (const finding of semanticFindings) for (const category of finding.addCategories) categorySet.add(category);
  const categories = matrix.CHANGE_CATEGORIES.filter((category) => categorySet.has(category));

  const pathRiskLevel = matrix.riskLevelFor(categories);
  const semanticRiskLevel = semanticFindings.reduce((level, finding) => Math.max(level, finding.escalateTo), 0);
  const riskLevelNumber = Math.max(pathRiskLevel, semanticRiskLevel);
  const riskLevel = RISK_LEVEL_NAMES[riskLevelNumber];

  const invalidatedEvidence = riskLevelNumber === 5 ? [...matrix.EVIDENCE_TYPES] : matrix.invalidatedEvidenceFor(categories);
  const invalidatedFingerprints = riskLevelNumber === 5 ? [...matrix.FINGERPRINT_TYPES] : matrix.invalidatedFingerprintsFor(categories);
  const retainedEvidence = matrix.retainedEvidenceFor(invalidatedEvidence);
  const requiredStages = riskLevelNumber === 5 ? [] : matrix.requiredStagesFor(categories);
  const requiredApprovals = matrix.approvalsFor(riskLevelNumber);

  const blockers = [];
  const warnings = [];

  if (riskLevelNumber === 5) {
    blockers.push("LEVEL_5 change detected: live-trading capability, private API, credential storage, or an unclassifiable security-boundary change. This is not an approvable change; the design must be revisited.");
  }
  if (categorySet.has("UNKNOWN")) {
    warnings.push("UNKNOWN_FILE_CLASSIFICATION: at least one changed path matched no classification rule and was treated as high risk by default.");
  }
  for (const finding of semanticFindings) {
    if (finding.id === "TEST_SKIP_ADDED") warnings.push(`TEST_WEAKENING: a skip/todo was added in ${finding.path}`);
    if (finding.id === "TEST_ASSERTION_REMOVED") warnings.push(`TEST_WEAKENING: assertions were removed in ${finding.path}`);
    if (finding.id === "ACCEPTANCE_MINIMUM_REDUCED") warnings.push(`ACCEPTANCE_RELAXATION: ${finding.detail} in ${finding.path}`);
    if (finding.id === "RISK_LIMIT_INCREASED") warnings.push(`RISK_RELAXATION: ${finding.detail} in ${finding.path}`);
  }

  // Any invalidated fingerprint invalidates every approval bound to it, and any shipped
  // change requires a new release identity -- an artifact is never replaced in place.
  const approvalInvalidated = invalidatedFingerprints.length > 0;
  const shipsRuntime = invalidatedFingerprints.includes("RUNTIME");

  let changeDecision;
  if (riskLevelNumber === 5) changeDecision = "REJECT_CHANGE";
  else if (riskLevelNumber >= 3) changeDecision = "APPROVED_FOR_REVALIDATION";
  else if (riskLevelNumber >= 1) changeDecision = "APPROVED_FOR_IMPLEMENTATION";
  else changeDecision = "APPROVED_FOR_IMPLEMENTATION";

  const emergency = changeSet.changeRequest.emergency === true;
  if (emergency && changeSet.changeRequest.rollbackConsidered === false) {
    warnings.push("EMERGENCY_WITHOUT_ROLLBACK_EVALUATION: rollback must be evaluated before a hotfix is preferred.");
  }

  const result = {
    schemaVersion: 1,
    changeId: changeSet.changeId,
    status: "PASS",
    baselineCommitSha: changeSet.baselineCommitSha,
    targetCommitSha: changeSet.targetCommitSha,
    changedFiles,
    categories,
    riskLevel,
    riskLevelNumber,
    semanticFindings,
    invalidatedFingerprints,
    approvalInvalidated,
    invalidatedEvidence,
    retainedEvidence,
    evidenceAvailability: matrix.EVIDENCE_AVAILABILITY,
    requiredStages,
    requiredApprovals,
    releasePolicy: {
      newReleaseIdRequired: shipsRuntime,
      sameVersionBinaryReplacementAllowed: false,
      artifactImmutable: true
    },
    emergency,
    changeDecision,
    blockers,
    warnings
  };
  result.hashes = {
    changeSetSha256: canonicalHash(changeSet),
    changedFilesSha256: canonicalHash(changedFiles),
    categoriesSha256: canonicalHash(categories),
    resultSha256: canonicalHash({ categories, riskLevel, invalidatedFingerprints, invalidatedEvidence, requiredStages, requiredApprovals, changeDecision })
  };
  return result;
}

module.exports = { analyzeChangeImpact, validateChangeSet, classifyPath, scanSemantics, detectPolicyRelaxation, RISK_LEVEL_NAMES };
