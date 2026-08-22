"use strict";

const fs = require("node:fs");
const path = require("node:path");

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

function result(status, input, reasons, checks) {
  const conformance = input?.venueConformance || {};
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
    venueId: nonEmpty(conformance.venueId) ? conformance.venueId : null,
    accountId: nonEmpty(conformance.accountId) ? conformance.accountId : null,
    reasons: Object.freeze([...new Set(reasons)].sort()),
    checks: Object.freeze(checks),
  });
}

function evaluateStrategyStagePromotion(input) {
  const reasons = [];
  const checks = [];

  function add(id, status, reason) {
    checks.push(Object.freeze({ id, status, reason }));
    if (status !== "PASS") reasons.push(reason);
  }

  if (!input || typeof input !== "object" || input.schemaVersion !== 1) {
    add("request", "INVALID", "PROMOTION_REQUEST_INVALID");
    return result("INVALID", input, reasons, checks);
  }

  const transition = `${input.fromStage || ""}->${input.toStage || ""}`;
  if (!SUPPORTED_TRANSITIONS.has(transition)) {
    add("transition", "INVALID", "PROMOTION_TRANSITION_UNSUPPORTED");
    return result("INVALID", input, reasons, checks);
  }
  add("transition", "PASS", "PROMOTION_TRANSITION_SUPPORTED");

  if (!nonEmpty(input.promotionId) || !nonEmpty(input.strategyId)) {
    add("identity", "INVALID", "PROMOTION_IDENTITY_INVALID");
    return result("INVALID", input, reasons, checks);
  }
  if (!validHash(input.strategyHash) || !validHash(input.venuePolicyHash) || !validHash(input.accountPolicyHash)) {
    add("binding-request", "INVALID", "PROMOTION_BINDING_HASH_INVALID");
    return result("INVALID", input, reasons, checks);
  }
  add("identity", "PASS", "PROMOTION_IDENTITY_VALID");
  add("binding-request", "PASS", "PROMOTION_BINDING_HASH_VALID");

  const conformance = input.venueConformance;
  if (!conformance || typeof conformance !== "object") {
    add("venue-conformance", "UNKNOWN", "VENUE_CONFORMANCE_MISSING");
    return result("UNKNOWN", input, reasons, checks);
  }

  if (!nonEmpty(conformance.strategyId) || !nonEmpty(conformance.venueId) || !nonEmpty(conformance.accountId)) {
    add("conformance-identity", "UNKNOWN", "VENUE_CONFORMANCE_IDENTITY_UNKNOWN");
  } else if (conformance.strategyId !== input.strategyId) {
    add("conformance-identity", "BLOCK", "VENUE_CONFORMANCE_STRATEGY_ID_MISMATCH");
  } else {
    add("conformance-identity", "PASS", "VENUE_CONFORMANCE_IDENTITY_MATCH");
  }

  const binding = conformance.binding;
  if (!binding || !validHash(binding.strategyHash) || !validHash(binding.venuePolicyHash) || !validHash(binding.accountPolicyHash)) {
    add("conformance-binding", "UNKNOWN", "VENUE_CONFORMANCE_BINDING_UNKNOWN");
  } else if (binding.strategyHash !== input.strategyHash) {
    add("conformance-binding", "BLOCK", "VENUE_CONFORMANCE_STRATEGY_HASH_MISMATCH");
  } else if (binding.venuePolicyHash !== input.venuePolicyHash) {
    add("conformance-binding", "BLOCK", "VENUE_CONFORMANCE_VENUE_POLICY_STALE");
  } else if (binding.accountPolicyHash !== input.accountPolicyHash) {
    add("conformance-binding", "BLOCK", "VENUE_CONFORMANCE_ACCOUNT_POLICY_STALE");
  } else {
    add("conformance-binding", "PASS", "VENUE_CONFORMANCE_BINDING_MATCH");
  }

  if (conformance.status === "BLOCK") {
    add("conformance-result", "BLOCK", "VENUE_CONFORMANCE_BLOCKED");
  } else if (conformance.status !== "PASS" || conformance.deployable !== true) {
    add("conformance-result", "UNKNOWN", "VENUE_CONFORMANCE_NOT_PASS");
  } else if (!Array.isArray(conformance.checks) || conformance.checks.length === 0) {
    add("conformance-result", "UNKNOWN", "VENUE_CONFORMANCE_CHECKS_MISSING");
  } else if (conformance.checks.some((check) => check?.status !== "PASS") || (Array.isArray(conformance.reasons) && conformance.reasons.length > 0)) {
    add("conformance-result", "BLOCK", "VENUE_CONFORMANCE_RESULT_INCONSISTENT");
  } else {
    add("conformance-result", "PASS", "VENUE_CONFORMANCE_PASS");
  }

  const finalStatus = checks.some((check) => check.status === "INVALID")
    ? "INVALID"
    : checks.some((check) => check.status === "BLOCK")
      ? "BLOCK"
      : checks.some((check) => check.status === "UNKNOWN")
        ? "UNKNOWN"
        : "PASS";

  return result(finalStatus, input, reasons, checks);
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
