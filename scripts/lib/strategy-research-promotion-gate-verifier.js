"use strict";
/**
 * Independent verification of a strategy research scorecard (WO-0031).
 *
 * Does NOT call the runner's dimension evaluators or its decision helper. It re-derives
 * the blocking conditions and the gate outcome from the scorecard's own recorded
 * dimension statuses and manifest, so a runner that quietly upgraded a dimension or
 * softened a decision is caught rather than confirmed.
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

  // Manifest completeness and canonical order.
  const types = result.evidenceManifest.map((entry) => entry.evidenceType);
  if (canonicalHash(types) !== canonicalHash([...EVIDENCE_ORDER])) errors.push("evidence manifest is not in canonical order or is missing entries");

  // Every declared evidence entry must belong to the requested strategy.
  for (const entry of request.manifest.evidence ?? []) {
    if (entry.strategyFingerprint !== request.strategy.strategyFingerprint) {
      errors.push(`evidence ${entry.evidenceType} carries a different strategy fingerprint than the request`);
    }
  }

  // Ten dimensions, no more, no fewer.
  if (result.dimensions.length !== 10) errors.push(`expected 10 dimensions, found ${result.dimensions.length}`);
  const byId = Object.fromEntries(result.dimensions.map((dimension) => [dimension.id, dimension]));

  // Synthetic evidence can never carry a MARKET-PERFORMANCE dimension at
  // STRONG/ACCEPTABLE, and can never yield HIGH confidence. Three dimensions are exempt
  // because they do not assert anything about a market: D-002 (backtest integrity --
  // determinism, no look-ahead, shared accounting) and D-010 (operational Paper safety
  // -- persistence atomicity, kill switch, duplicate protection) measure properties of
  // the code, which hold or fail regardless of which candles were fed in; D-008 (sample
  // sufficiency) counts how much evidence exists, which is a property of the evidence
  // set itself, not a claim that the strategy performed.
  const PROVENANCE_EXEMPT = new Set(["D-002", "D-008", "D-010"]);
  for (const dimension of result.dimensions) {
    if (dimension.trust === "VERIFIED_SYNTHETIC") {
      if (dimension.confidence === "HIGH") errors.push(`${dimension.id}: synthetic evidence must not yield HIGH confidence`);
      if (!PROVENANCE_EXEMPT.has(dimension.id) && PROMOTABLE.has(dimension.status)) {
        errors.push(`${dimension.id}: a market-performance dimension cannot be ${dimension.status} on synthetic evidence`);
      }
    }
  }

  // Missing evidence must produce a blocker and must not be silently tolerated.
  for (const entry of result.evidenceManifest) {
    if (!entry.present && !result.blockers.some((blocker) => blocker.detail.includes(entry.evidenceType))) {
      errors.push(`${entry.evidenceType} is missing but produced no blocker`);
    }
    if (entry.fileVerification === "HASH_MISMATCH" && !result.blockers.some((b) => b.detail.includes(entry.evidenceType))) {
      errors.push(`${entry.evidenceType} hash mismatch produced no blocker`);
    }
  }

  // Independently re-derived gate outcome.
  const anyMissing = result.evidenceManifest.some((entry) => !entry.present);
  const anyInvalidEvidence = result.evidenceManifest.some((entry) => entry.trust === "INVALID");
  const anySynthetic = result.evidenceManifest.some((entry) => entry.present && entry.trust === "VERIFIED_SYNTHETIC");
  const safety = byId["D-010"];

  if (result.researchDecision === "PROMOTE_TO_EXTENDED_PAPER_REVIEW") {
    if (anyMissing) errors.push("PROMOTE decided with missing evidence");
    if (anyInvalidEvidence) errors.push("PROMOTE decided with INVALID evidence");
    if (anySynthetic) errors.push("PROMOTE decided on synthetic evidence");
    if (result.blockers.length > 0) errors.push("PROMOTE decided while blockers remain");
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

  // No numeric total score may exist -- a weighted score can average away a hard failure.
  if (Object.prototype.hasOwnProperty.call(result, "totalScore") || Object.prototype.hasOwnProperty.call(result, "score")) {
    errors.push("a single numeric total score must not be produced; blocking conditions must outrank any score");
  }

  // Prohibited actions are unconditional.
  for (const required of ["Enable Live Trading", "Place real orders", "Use the Upbit private API", "Store credentials"]) {
    if (!result.prohibitedActions.includes(required)) errors.push(`prohibited action list is missing: ${required}`);
  }

  // Owner review must start PENDING and must never be self-approved.
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
