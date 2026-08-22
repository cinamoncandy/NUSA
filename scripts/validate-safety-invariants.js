"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { validateSafetyArchitecture } = require("./validate-safety-architecture");
const { validateShadowGovernance } = require("./validate-shadow-governance");
const { validateRestrictedLiveGovernance } = require("./validate-restricted-live-governance");

function unique(values) {
  return [...new Set(values)].sort();
}

function hasAll(values, required) {
  const set = new Set(Array.isArray(values) ? values : []);
  return required.every((value) => set.has(value));
}

function verifySafetyInvariants(input) {
  const failures = [];
  const safety = input?.safety || {};
  const shadow = input?.shadow || {};
  const restricted = input?.restricted || {};
  const shadowRuntimeSource = input?.shadowRuntimeSource || "";

  const safetyValidation = validateSafetyArchitecture(safety);
  for (const failure of safetyValidation.failures) failures.push(`SAFETY_ARCHITECTURE:${failure}`);

  for (const failure of validateShadowGovernance(shadow, shadowRuntimeSource)) {
    failures.push(`SHADOW_GOVERNANCE:${failure}`);
  }

  try {
    validateRestrictedLiveGovernance(restricted);
  } catch (error) {
    failures.push(`RESTRICTED_LIVE:${error?.code || error?.message || "VALIDATION_FAILED"}`);
  }

  if (input?.aiZeroAuthorityPass !== true) failures.push("AI_ZERO_AUTHORITY:FAILED");

  const hardRiskCoherent =
    safety?.authorities?.hardRiskGovernor?.finalForHardLimits === true &&
    safety?.authorities?.hardRiskGovernor?.learnedOverrideAllowed === false &&
    safety?.authorities?.learnedRisk?.mayRelaxHardLimits === false &&
    shadow?.decision_rewrite?.hard_risk_reject_to_allow === "PROHIBITED" &&
    shadow?.decision_rewrite?.hard_risk_halt_to_allow === "PROHIBITED" &&
    hasAll(restricted?.prohibitions, ["hard_risk_override", "kill_switch_override"]);
  if (!hardRiskCoherent) failures.push("INVARIANT_HARD_RISK_NON_OVERRIDABLE");

  const humanAuthorityCoherent =
    hasAll(safety?.forbiddenOverrides, ["human-live-authority", "production-promotion-authority"]) &&
    shadow?.promotion?.shadow_evidence_sufficient_for_live_authorization === false &&
    shadow?.promotion?.shadow_evidence_sufficient_for_production_promotion === false &&
    shadow?.promotion?.autonomous_production_mutation === false &&
    restricted?.authorities?.live === "human-live-authority" &&
    restricted?.authorities?.production_promotion === "human-production-promotion-authority" &&
    hasAll(restricted?.prohibitions, [
      "ai_live_authority",
      "meta_ai_live_authority",
      "shadow_evidence_live_authority",
      "promotion_evidence_live_authority",
      "ci_live_authority",
      "automation_live_authority",
    ]);
  if (!humanAuthorityCoherent) failures.push("INVARIANT_HUMAN_LIVE_AUTHORITY");

  const unknownCoherent =
    safety?.unknownPolicy?.safetyCriticalUnknownBlocksRiskIncrease === true &&
    safety?.unknownPolicy?.unknownMayAuthorizeRiskIncrease === false &&
    restricted?.requirements?.safety_critical_unknown_must_be_false === true;
  if (!unknownCoherent) failures.push("INVARIANT_SAFETY_CRITICAL_UNKNOWN_FAIL_CLOSED");

  const haltRecoveryCoherent =
    safety?.authorities?.recovery?.haltImprovementRequiresHumanAuthorization === true &&
    safety?.authorities?.recovery?.authorizationEvidenceRequired === true &&
    shadow?.decision_rewrite?.safety_halt_to_allow === "PROHIBITED" &&
    hasAll(restricted?.prohibitions, ["halt_override"]) &&
    restricted?.break_glass?.may_override_halt === false;
  if (!haltRecoveryCoherent) failures.push("INVARIANT_HALT_RECOVERY_HUMAN_CONTROLLED");

  const mutationBoundaryCoherent =
    safety?.liveTradingMutation === "prohibited" &&
    safety?.productionPromotionMutation === "prohibited" &&
    shadow?.execution_transport_connected === false &&
    ["broker", "order", "fill", "cash", "position"].every((domain) => shadow?.mutations?.[domain] === "PROHIBITED") &&
    restricted?.default_state === "DISABLED" &&
    restricted?.execution_transport_connected === false &&
    restricted?.credential_storage_present === false &&
    restricted?.automatic_live_activation_allowed === false;
  if (!mutationBoundaryCoherent) failures.push("INVARIANT_MUTATION_BOUNDARY");

  return Object.freeze({ pass: failures.length === 0, failures: unique(failures) });
}

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function loadRepositoryInputs(root = process.cwd()) {
  const safety = readJson(root, path.join("config", "safety", "architecture.json"));
  const shadow = readJson(root, path.join("config", "shadow", "governance.json"));
  const restricted = readJson(root, path.join("config", "live", "restricted-live-governance.json"));
  const implementation = shadow?.runtime_binding?.implementation;
  const shadowRuntimePath = typeof implementation === "string" && implementation.length > 0
    ? path.join(root, implementation)
    : null;
  const shadowRuntimeSource = shadowRuntimePath && fs.existsSync(shadowRuntimePath) && fs.statSync(shadowRuntimePath).isFile()
    ? fs.readFileSync(shadowRuntimePath, "utf8")
    : "";
  const aiGuard = spawnSync(process.execPath, [path.join(root, "scripts", "validate-ai-zero-authority.js")], {
    cwd: root,
    encoding: "utf8",
  });

  return {
    safety,
    shadow,
    restricted,
    shadowRuntimeSource,
    aiZeroAuthorityPass: aiGuard.status === 0,
    aiZeroAuthorityDetail: aiGuard.status === 0 ? "PASS" : (aiGuard.stderr || aiGuard.stdout || "FAILED").trim(),
  };
}

function main() {
  const inputs = loadRepositoryInputs();
  const result = verifySafetyInvariants(inputs);
  if (!result.pass) {
    console.error("Safety invariant coherence validation FAILED");
    for (const failure of result.failures) console.error(`- ${failure}`);
    if (!inputs.aiZeroAuthorityPass && inputs.aiZeroAuthorityDetail) console.error(`- ${inputs.aiZeroAuthorityDetail}`);
    process.exitCode = 1;
    return;
  }
  console.log("Safety invariant coherence validation PASS (hard-risk, human authority, fail-closed unknown, HALT recovery, mutation boundary)");
}

if (require.main === module) main();

module.exports = { verifySafetyInvariants, loadRepositoryInputs };
