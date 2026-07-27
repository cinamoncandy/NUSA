"use strict";
/**
 * Independent verification of a change-impact result (WO-0037).
 *
 * Does NOT call scripts/lib/change-impact-analyzer.js's classifier or semantic scanner.
 * It consults the DECLARED POLICY in evidence-invalidation-matrix.js (that is shared
 * policy data, not derivation logic) and otherwise re-derives everything with its own
 * independent scan. The point is that if the analyzer's scanner missed a live-trading
 * endpoint, silently kept an invalidated evidence type alive, or quietly downgraded a
 * risk level, this module catches it rather than agreeing with it.
 */
const { canonicalHash } = require("./canonical-hash.js");
const matrix = require("./evidence-invalidation-matrix.js");

/** Independent high-risk patterns, written separately from the analyzer's rule table.
 * Intentionally broader/blunter: a verifier should over-flag rather than under-flag. */
const INDEPENDENT_CRITICAL_PATTERNS = Object.freeze([
  { id: "LIVE_OR_PRIVATE_CAPABILITY", pattern: /(liveTrading|LIVE_TRADING|placeOrder|submitOrder|realOrder|api\.upbit\.com\/v1\/(orders|accounts|withdraws|deposits)|privateApi)/i },
  { id: "CREDENTIAL_STORAGE", pattern: /(accessKey|secretKey|apiKey|api_secret|privateKey|credential|jwtSecret)/i }
]);

const INDEPENDENT_HIGH_RISK_PATTERNS = Object.freeze([
  { id: "STRATEGY_OR_SIZING", pattern: /(shortWindow|longWindow|shortPeriod|longPeriod|orderQuantity|orderSize|positionSize)\s*[:=]/ },
  { id: "RISK_LIMIT", pattern: /(maxOrderNotional|maxPosition|dailyLossLimit|consecutiveLossLimit|maxRealizedLoss)\s*[:=]/ },
  { id: "ACCOUNTING_FORMULA", pattern: /(averagePrice|realizedPnl|feeRate)\s*[:=]/ },
  { id: "KILL_SWITCH", pattern: /(killSwitch|failClosed|emergencyStop)/i }
]);

const TEST_WEAKENING_PATTERN = /\b(test|it|describe)\.(skip|todo)\b|\bskip\s*:\s*true\b/;

/** Independently re-derived shipping-path rule (see the analyzer's SHIPPING_PATH note).
 * A production-behaviour token only proves a production change when it appears in code
 * that actually ships; the critical security patterns above stay global regardless. */
const SHIPPING_PATH = /^(apps|packages)\//;

function verifyChangeControlResult(changeSet, result) {
  const errors = [];
  if (!result || result.status === undefined) { errors.push("result is missing a status field"); return { status: "FAIL", errors }; }
  if (result.status === "FAIL" && result.changedFiles.length === 0) {
    return { status: "PASS", errors: [], note: "change-set validation failure; nothing further to verify" };
  }

  // 1. Changed-file completeness: no input file may be dropped from the analysis.
  const analyzedPaths = new Set(result.changedFiles.map((file) => file.path));
  for (const file of changeSet.changedFiles) {
    if (!analyzedPaths.has(file.path)) errors.push(`changed file omitted from the analysis: ${file.path}`);
  }
  if (result.changedFiles.length !== changeSet.changedFiles.length) {
    errors.push(`changed-file count mismatch: input had ${changeSet.changedFiles.length}, result analyzed ${result.changedFiles.length}`);
  }

  // 2. Independent critical scan. If this finds a live/private/credential capability,
  //    the result MUST be LEVEL_5 and MUST be rejected -- no exceptions, no approvals.
  const criticalHits = [];
  const highRiskHits = [];
  const testWeakeningHits = [];
  for (const file of changeSet.changedFiles) {
    const lines = [...(file.addedLines ?? []), ...(file.removedLines ?? [])];
    const addedOnly = file.addedLines ?? [];
    for (const rule of INDEPENDENT_CRITICAL_PATTERNS) {
      if (addedOnly.some((line) => rule.pattern.test(line))) criticalHits.push({ id: rule.id, path: file.path });
    }
    if (SHIPPING_PATH.test(file.path)) {
      for (const rule of INDEPENDENT_HIGH_RISK_PATTERNS) {
        if (lines.some((line) => rule.pattern.test(line))) highRiskHits.push({ id: rule.id, path: file.path });
      }
    }
    if (addedOnly.some((line) => TEST_WEAKENING_PATTERN.test(line))) testWeakeningHits.push({ path: file.path });
  }

  if (criticalHits.length > 0) {
    if (result.riskLevel !== "LEVEL_5") errors.push(`independent scan found a critical capability (${criticalHits.map((h) => `${h.id}@${h.path}`).join(", ")}) but the result is ${result.riskLevel}, not LEVEL_5`);
    if (result.changeDecision !== "REJECT_CHANGE") errors.push("a critical capability was found but the change was not rejected");
    if ((result.requiredApprovals ?? []).length > 0) errors.push("a LEVEL_5 change must have no approval path, but approvals were listed");
  }
  if (highRiskHits.length > 0 && result.riskLevelNumber < 4) {
    errors.push(`independent scan found high-risk edits (${highRiskHits.map((h) => `${h.id}@${h.path}`).join(", ")}) but the risk level is ${result.riskLevel}`);
  }
  if (testWeakeningHits.length > 0 && !(result.warnings ?? []).some((w) => w.startsWith("TEST_WEAKENING"))) {
    errors.push(`independent scan found added skip/todo in ${testWeakeningHits.map((h) => h.path).join(", ")} but no TEST_WEAKENING warning was raised`);
  }

  // 3. Risk level must be at least the declared policy floor for every listed category.
  const policyFloor = matrix.riskLevelFor(result.categories ?? []);
  if (result.riskLevelNumber < policyFloor) {
    errors.push(`risk level ${result.riskLevel} is below the declared policy floor for its own categories (${policyFloor})`);
  }

  // 4. UNKNOWN must never be low risk.
  if ((result.categories ?? []).includes("UNKNOWN") && result.riskLevelNumber < 4) {
    errors.push("an UNKNOWN category is present but the risk level is below LEVEL_4");
  }

  // 5. Evidence invalidation must cover at least everything policy requires. Silently
  //    keeping an evidence type alive is the specific failure this guards against.
  if (result.riskLevelNumber !== 5) {
    const requiredEvidence = matrix.invalidatedEvidenceFor(result.categories ?? []);
    const declared = new Set(result.invalidatedEvidence ?? []);
    for (const evidence of requiredEvidence) {
      if (!declared.has(evidence)) errors.push(`evidence ${evidence} must be invalidated for categories ${(result.categories ?? []).join(",")} but was retained`);
    }
    const requiredFingerprints = matrix.invalidatedFingerprintsFor(result.categories ?? []);
    const declaredFingerprints = new Set(result.invalidatedFingerprints ?? []);
    for (const fingerprint of requiredFingerprints) {
      if (!declaredFingerprints.has(fingerprint)) errors.push(`fingerprint ${fingerprint} must be invalidated but was retained`);
    }
    const requiredStages = matrix.requiredStagesFor(result.categories ?? []);
    const declaredStages = new Set(result.requiredStages ?? []);
    for (const stage of requiredStages) {
      if (!declaredStages.has(stage)) errors.push(`revalidation stage ${stage} is required but missing from the plan`);
    }
  } else if ((result.invalidatedEvidence ?? []).length !== matrix.EVIDENCE_TYPES.length) {
    errors.push("a LEVEL_5 change must invalidate every evidence type");
  }

  // 6. Retained and invalidated evidence must partition the vocabulary exactly.
  const invalidatedSet = new Set(result.invalidatedEvidence ?? []);
  const retainedSet = new Set(result.retainedEvidence ?? []);
  for (const evidence of matrix.EVIDENCE_TYPES) {
    const inInvalidated = invalidatedSet.has(evidence);
    const inRetained = retainedSet.has(evidence);
    if (inInvalidated && inRetained) errors.push(`evidence ${evidence} is listed as both invalidated and retained`);
    if (!inInvalidated && !inRetained) errors.push(`evidence ${evidence} is listed as neither invalidated nor retained`);
  }

  // 7. Approval level must match the declared policy for the risk level.
  const expectedApprovals = matrix.approvalsFor(result.riskLevelNumber);
  const declaredApprovals = result.requiredApprovals ?? [];
  if (canonicalHash(expectedApprovals) !== canonicalHash(declaredApprovals)) {
    errors.push(`required approvals do not match policy for ${result.riskLevel}: expected ${expectedApprovals.join(",")}, got ${declaredApprovals.join(",")}`);
  }

  // 8. Any invalidated fingerprint invalidates bound approvals; a runtime change always
  //    needs a new release identity and may never replace a binary in place.
  if ((result.invalidatedFingerprints ?? []).length > 0 && result.approvalInvalidated !== true) {
    errors.push("fingerprints were invalidated but approvalInvalidated was not set");
  }
  if ((result.invalidatedFingerprints ?? []).includes("RUNTIME") && result.releasePolicy?.newReleaseIdRequired !== true) {
    errors.push("a RUNTIME fingerprint change requires a new release ID");
  }
  if (result.releasePolicy && result.releasePolicy.sameVersionBinaryReplacementAllowed !== false) {
    errors.push("same-version binary replacement must never be permitted");
  }
  if (result.releasePolicy && result.releasePolicy.artifactImmutable !== true) {
    errors.push("artifacts must be declared immutable");
  }

  // 9. A change request is mandatory, including for an emergency hotfix.
  if (changeSet.changeRequest == null) errors.push("no change request was attached");
  if (changeSet.changeRequest?.emergency === true && changeSet.changeRequest?.rollbackConsidered !== true && !(result.warnings ?? []).some((w) => w.startsWith("EMERGENCY_WITHOUT_ROLLBACK_EVALUATION"))) {
    errors.push("an emergency change did not evaluate rollback first and no warning was raised");
  }

  // 10. Hashes.
  if (result.hashes) {
    if (canonicalHash(changeSet) !== result.hashes.changeSetSha256) errors.push("changeSetSha256 mismatch");
    if (canonicalHash(result.changedFiles) !== result.hashes.changedFilesSha256) errors.push("changedFilesSha256 mismatch (changed-file analysis may have been altered)");
    const recomputedResultHash = canonicalHash({
      categories: result.categories, riskLevel: result.riskLevel,
      invalidatedFingerprints: result.invalidatedFingerprints, invalidatedEvidence: result.invalidatedEvidence,
      requiredStages: result.requiredStages, requiredApprovals: result.requiredApprovals,
      changeDecision: result.changeDecision
    });
    if (recomputedResultHash !== result.hashes.resultSha256) errors.push("resultSha256 mismatch (risk level, evidence, stages, or decision may have been altered after hashing)");
  } else {
    errors.push("result.hashes is missing");
  }

  return { status: errors.length === 0 ? "PASS" : "FAIL", errors };
}

module.exports = { verifyChangeControlResult };
