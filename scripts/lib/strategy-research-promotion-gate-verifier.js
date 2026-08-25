"use strict";
/**
 * Independent verification of a strategy research scorecard (WO-0031).
 *
 * Does NOT call the runner's dimension evaluators or its decision helper. It re-derives
 * the blocking conditions and the gate outcome from the scorecard's own recorded
 * dimension statuses and the original request evidence, so a runner that quietly
 * upgrades evidence or softens a decision is caught rather than confirmed.
 */
const { canonicalHash } = require("./canonical-hash.js");
const { EVIDENCE_ORDER } = require("./strategy-research-evidence-manifest.js");

const PROMOTABLE = new Set(["STRONG", "ACCEPTABLE"]);

function verifyScorecard(request, result) {
  const errors = [];
  if (!result || result.executionStatus === undefined) return { status: "FAIL", errors: ["result is missing executionStatus"] };
  if (result.executionStatus === "INVALID" && result.dimensions.length === 0) {
    return { status: "PASS", errors: [], note: "request-level validation failure; nothing further to verify" };
  }

  const types = result.evidenceManifest.map((entry) => entry.evidenceType);
  if (canonicalHash(types) !== canonicalHash([...EVIDENCE_ORDER])) errors.push("evidence manifest is not in canonical order or is missing entries");

  for (const entry of request.manifest.evidence ?? []) {
    if (entry.strategyFingerprint !== request.strategy.strategyFingerprint) {
      errors.push(`evidence ${entry.evidenceType} carries a different strategy fingerprint than the request`);
    }
  }

  if (result.dimensions.length !== 10) errors.push(`expected 10 dimensions, found ${result.dimensions.length}`);
  const byId = Object.fromEntries(result.dimensions.map((dimension) => [dimension.id, dimension]));

  const PROVENANCE_EXEMPT = new Set(["D-002", "D-008", "D-010"]);
  for (const dimension of result.dimensions) {
    if (dimension.trust === "VERIFIED_SYNTHETIC") {
      if (dimension.confidence === "HIGH") errors.push(`${dimension.id}: synthetic evidence must not yield HIGH confidence`);
      if (!PROVENANCE_EXEMPT.has(dimension.id) && PROMOTABLE.has(dimension.status)) {
        errors.push(`${dimension.id}: a market-performance dimension cannot be ${dimension.status} on synthetic evidence`);
      }
    }
  }

  for (const entry of result.evidenceManifest) {
    if (!entry.present && !result.blockers.some((blocker) => blocker.detail.includes(entry.evidenceType))) {
      errors.push(`${entry.evidenceType} is missing but produced no blocker`);
    }
    if (entry.fileVerification === "HASH_MISMATCH" && !result.blockers.some((b) => b.detail.includes(entry.evidenceType))) {
      errors.push(`${entry.evidenceType} hash mismatch produced no blocker`);
    }
  }

  const anyMissing = result.evidenceManifest.some((entry) => !entry.present);
  const anyInvalidEvidence = result.evidenceManifest.some((entry) => entry.trust === "INVALID");
  const anySynthetic = result.evidenceManifest.some((entry) => entry.present && entry.trust === "VERIFIED_SYNTHETIC");
  const dataIntegrity = byId["D-001"];
  const datasetQualityEvidence = (request.manifest.evidence ?? []).find((entry) => entry.evidenceType === "DATASET_QUALITY");
  const sourceSelectionBiasControlStatus = datasetQualityEvidence?.metrics?.selectionBiasControlStatus ?? "UNVERIFIED";
  const sourceSurvivorshipBiasControlStatus = datasetQualityEvidence?.metrics?.survivorshipBiasControlStatus ?? "UNVERIFIED";
  const safety = byId["D-010"];

  if (dataIntegrity) {
    if (dataIntegrity.metrics?.selectionBiasControlStatus !== sourceSelectionBiasControlStatus) {
      errors.push("D-001 selection-bias control status does not match original DATASET_QUALITY evidence");
    }
    if (dataIntegrity.metrics?.survivorshipBiasControlStatus !== sourceSurvivorshipBiasControlStatus) {
      errors.push("D-001 survivorship-bias control status does not match original DATASET_QUALITY evidence");
    }
  }

  if (result.researchDecision === "PROMOTE_TO_EXTENDED_PAPER_REVIEW") {
    if (anyMissing) errors.push("PROMOTE decided with missing evidence");
    if (anyInvalidEvidence) errors.push("PROMOTE decided with INVALID evidence");
    if (anySynthetic) errors.push("PROMOTE decided on synthetic evidence");
    if (result.blockers.length > 0) errors.push("PROMOTE decided while blockers remain");
    if (sourceSelectionBiasControlStatus !== "VERIFIED") {
      errors.push("PROMOTE decided without VERIFIED selection-bias correction in original DATASET_QUALITY evidence");
    }
    if (sourceSurvivorshipBiasControlStatus !== "VERIFIED") {
      errors.push("PROMOTE decided without VERIFIED survivorship-bias correction in original DATASET_QUALITY evidence");
    }
    if (!dataIntegrity || dataIntegrity.metrics?.selectionBiasControlStatus !== "VERIFIED") {
      errors.push("PROMOTE decided without VERIFIED selection-bias correction evidence");
    }
    if (!dataIntegrity || dataIntegrity.metrics?.survivorshipBiasControlStatus !== "VERIFIED") {
      errors.push("PROMOTE decided without VERIFIED survivorship-bias correction evidence");
    }
    if (!safety || !PROMOTABLE.has(safety.status)) errors.push("PROMOTE decided without established operational Paper safety");
    for (const dimension of result.dimensions) {
      if (!PROMOTABLE.has(dimension.status)) errors.push(`PROMOTE decided while ${dimension.id} is ${dimension.status}`);
    }
  }
  if (byId["D-002"] && byId["D-002"].status === "FAIL" && result.researchDecision !== "INVALID") {
    errors.push("backtest integrity FAIL must force INVALID");
  }
  if (safety && safety.status === "FAIL" && result.researchDecision !== "INVALID") {
    errors.push("operational Paper safety FAIL must force INVALID, not a softer decision");
  }
  if (anyInvalidEvidence && result.researchDecision !== "INVALID") {
    errors.push("INVALID evidence must force an INVALID decision");
  }
  if (anyMissing && !["INSUFFICIENT_EVIDENCE", "INVALID"].includes(result.researchDecision)) {
    errors.push("missing evidence must force INSUFFICIENT_EVIDENCE or INVALID");
  }

  if (Object.prototype.hasOwnProperty.call(result, "totalScore") || Object.prototype.hasOwnProperty.call(result, "score")) {
    errors.push("a single numeric total score must not be produced; blocking conditions must outrank any score");
  }

  for (const required of ["Enable Live Trading", "Place real orders", "Use the Upbit private API", "Store credentials"]) {
    if (!result.prohibitedActions.includes(required)) errors.push(`prohibited action list is missing: ${required}`);
  }

  if (result.ownerReview?.status !== "PENDING") errors.push("owner review must start PENDING; the scorecard cannot approve itself");
  if (result.ownerReview?.approvedBy != null) errors.push("owner review must not carry an approver");

  if (result.hashes) {
    if (canonicalHash(request) !== result.hashes.requestSha256) errors.push("requestSha256 mismatch");
    if (canonicalHash(result.dimensions) !== result.hashes.dimensionsSha256) errors.push("dimensionsSha256 mismatch (a dimension may have been altered after hashing)");
    if (canonicalHash(result.blockers) !== result.hashes.blockersSha256) errors.push("blockersSha256 mismatch");
    if (canonicalHash({ decision: result.researchDecision, reasons: result.decisionReasons }) !== result.hashes.decisionSha256) errors.push("decisionSha256 mismatch (the decision may have been altered after hashing)");
    if (result.hashes.strategyFingerprint !== request.strategy.strategyFingerprint) errors.push("strategy fingerprint mismatch");
  } else {
    errors.push("result.hashes is missing");
  }

  return { status: errors.length === 0 ? "PASS" : "FAIL", errors };
}

module.exports = { verifyScorecard };
