"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { evaluateVenueConformance, sha256Json } = require("./venue-conformance-harness");

const SUPPORTED_TRANSITIONS = new Set([
  "PAPER->SHADOW",
  "SHADOW->RESTRICTED_LIVE",
]);

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validHash(value) {
  return typeof value === "string" && SHA256_RE.test(value);
}

function result(status, input, conformance, reasons, checks) {
  return Object.freeze({
    schemaVersion: 1,
    promotionId: nonEmpty(input?.promotionId) ? input.promotionId : null,
    transition: nonEmpty(input?.fromStage) && nonEmpty(input?.toStage)
      ? `${input.fromStage}->${input.toStage}`
      : null,
    status,
    eligible: status === "PASS",
    mutationAuthorized: false,
    liveAuthority: "NONE",
    strategyId: nonEmpty(input?.strategyId) ? input.strategyId : null,
    strategyHash: validHash(input?.strategyHash) ? input.strategyHash : null,
    venueId: nonEmpty(conformance?.venueId) ? conformance.venueId : null,
    accountId: nonEmpty(conformance?.accountId) ? conformance.accountId : null,
    reasons: Object.freeze([...new Set(reasons)].sort()),
    checks: Object.freeze(checks),
  });
}

function finalStatus(checks) {
  if (checks.some((check) => check.status === "INVALID")) return "INVALID";
  if (checks.some((check) => check.status === "BLOCK")) return "BLOCK";
  if (checks.some((check) => check.status === "UNKNOWN")) return "UNKNOWN";
  return "PASS";
}

function evaluateStrategyStagePromotion(input) {
  const reasons = [];
  const checks = [];
  let recomputed = null;

  function add(id, status, reason) {
    checks.push(Object.freeze({ id, status, reason }));
    if (status !== "PASS") reasons.push(reason);
  }

  if (!input || typeof input !== "object" || input.schemaVersion !== 1) {
    add("request", "INVALID", "PROMOTION_REQUEST_INVALID");
    return result("INVALID", input, recomputed, reasons, checks);
  }

  const transition = `${input.fromStage || ""}->${input.toStage || ""}`;
  if (!SUPPORTED_TRANSITIONS.has(transition)) {
    add("transition", "INVALID", "PROMOTION_TRANSITION_UNSUPPORTED");
    return result("INVALID", input, recomputed, reasons, checks);
  }
  add("transition", "PASS", "PROMOTION_TRANSITION_SUPPORTED");

  if (!nonEmpty(input.promotionId) || !nonEmpty(input.strategyId)) {
    add("identity", "INVALID", "PROMOTION_IDENTITY_INVALID");
    return result("INVALID", input, recomputed, reasons, checks);
  }
  if (!validHash(input.strategyHash) || !validHash(input.venuePolicyHash) || !validHash(input.accountPolicyHash)) {
    add("binding-request", "INVALID", "PROMOTION_BINDING_HASH_INVALID");
    return result("INVALID", input, recomputed, reasons, checks);
  }
  add("identity", "PASS", "PROMOTION_IDENTITY_VALID");
  add("binding-request", "PASS", "PROMOTION_BINDING_HASH_VALID");

  const current = input.conformanceInput;
  if (!current || typeof current !== "object" || !current.strategy || !current.venue || !current.account) {
    add("current-conformance-input", "UNKNOWN", "CURRENT_CONFORMANCE_INPUT_MISSING");
    return result("UNKNOWN", input, recomputed, reasons, checks);
  }

  recomputed = evaluateVenueConformance(current);
  add("current-conformance-input", "PASS", "CURRENT_CONFORMANCE_RECOMPUTED");

  if (recomputed.strategyId !== input.strategyId) {
    add("current-strategy-identity", "BLOCK", "CURRENT_STRATEGY_ID_MISMATCH");
  } else {
    add("current-strategy-identity", "PASS", "CURRENT_STRATEGY_ID_MATCH");
  }

  if (recomputed.binding.strategyHash !== input.strategyHash) {
    add("current-strategy-binding", "BLOCK", "CURRENT_STRATEGY_HASH_MISMATCH");
  } else {
    add("current-strategy-binding", "PASS", "CURRENT_STRATEGY_HASH_MATCH");
  }
  if (recomputed.binding.venuePolicyHash !== input.venuePolicyHash) {
    add("current-venue-binding", "BLOCK", "CURRENT_VENUE_POLICY_HASH_MISMATCH");
  } else {
    add("current-venue-binding", "PASS", "CURRENT_VENUE_POLICY_HASH_MATCH");
  }
  if (recomputed.binding.accountPolicyHash !== input.accountPolicyHash) {
    add("current-account-binding", "BLOCK", "CURRENT_ACCOUNT_POLICY_HASH_MISMATCH");
  } else {
    add("current-account-binding", "PASS", "CURRENT_ACCOUNT_POLICY_HASH_MATCH");
  }

  const evidence = input.venueConformance;
  if (!evidence || typeof evidence !== "object") {
    add("venue-conformance-evidence", "UNKNOWN", "VENUE_CONFORMANCE_EVIDENCE_MISSING");
    return result(finalStatus(checks), input, recomputed, reasons, checks);
  }

  const canonicalEvidenceHash = sha256Json(recomputed);
  const suppliedEvidenceHash = sha256Json(evidence);
  if (canonicalEvidenceHash !== suppliedEvidenceHash) {
    add("venue-conformance-evidence", "BLOCK", "VENUE_CONFORMANCE_EVIDENCE_STALE_OR_TAMPERED");
  } else {
    add("venue-conformance-evidence", "PASS", "VENUE_CONFORMANCE_EVIDENCE_CANONICAL");
  }

  if (recomputed.status === "BLOCK") {
    add("conformance-result", "BLOCK", "VENUE_CONFORMANCE_BLOCKED");
  } else if (recomputed.status !== "PASS" || recomputed.deployable !== true) {
    add("conformance-result", "UNKNOWN", "VENUE_CONFORMANCE_NOT_PASS");
  } else if (!Array.isArray(recomputed.checks) || recomputed.checks.length === 0) {
    add("conformance-result", "UNKNOWN", "VENUE_CONFORMANCE_CHECKS_MISSING");
  } else if (recomputed.checks.some((check) => check?.status !== "PASS") || recomputed.reasons.length > 0) {
    add("conformance-result", "BLOCK", "VENUE_CONFORMANCE_RESULT_INCONSISTENT");
  } else {
    add("conformance-result", "PASS", "VENUE_CONFORMANCE_PASS");
  }

  return result(finalStatus(checks), input, recomputed, reasons, checks);
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: node scripts/strategy-stage-promotion-gate.js <promotion-request.json>");
    process.exitCode = 64;
    return;
  }

  const absolutePath = path.resolve(process.cwd(), inputPath);
  const input = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  const evaluation = evaluateStrategyStagePromotion(input);
  console.log(JSON.stringify(evaluation, null, 2));
  process.exitCode = evaluation.status === "PASS" ? 0 : evaluation.status === "BLOCK" ? 2 : evaluation.status === "UNKNOWN" ? 3 : 64;
}

if (require.main === module) main();

module.exports = { evaluateStrategyStagePromotion };
