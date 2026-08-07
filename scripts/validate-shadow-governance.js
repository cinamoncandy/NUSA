"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_IDENTITIES = [
  "source_revision_required",
  "deployment_bundle_required",
  "strategy_identity_required",
  "safety_policy_identity_required",
  "market_data_provenance_required",
];
const MUTATION_DOMAINS = ["broker", "order", "fill", "cash", "position"];
const REWRITE_RULES = [
  "hard_risk_reject_to_allow",
  "hard_risk_halt_to_allow",
  "safety_restricted_to_allow",
  "safety_halt_to_allow",
];

function validateShadowGovernance(config, runtimeSource) {
  const errors = [];
  if (!config || config.version !== 1) errors.push("SHADOW_VERSION_INVALID");
  if (config?.mode !== "SHADOW_READ_ONLY") errors.push("SHADOW_MODE_INVALID");
  if (config?.authority !== "OBSERVATION_ONLY") errors.push("SHADOW_AUTHORITY_INVALID");
  if (config?.production_equivalent_decision_path !== true) errors.push("SHADOW_DECISION_PATH_NOT_EQUIVALENT");
  if (config?.execution_transport_connected !== false) errors.push("SHADOW_EXECUTION_TRANSPORT_CONNECTED");

  for (const key of REQUIRED_IDENTITIES) {
    if (config?.identities?.[key] !== true) errors.push(`SHADOW_IDENTITY_BINDING_MISSING:${key}`);
  }
  for (const domain of MUTATION_DOMAINS) {
    if (config?.mutations?.[domain] !== "PROHIBITED") errors.push(`SHADOW_MUTATION_NOT_PROHIBITED:${domain}`);
  }
  if (config?.evidence?.hash_chain_required !== true) errors.push("SHADOW_HASH_CHAIN_NOT_REQUIRED");
  if (config?.evidence?.zero_actual_mutation_counters_required !== true) errors.push("SHADOW_ZERO_MUTATION_EVIDENCE_NOT_REQUIRED");
  if (config?.evidence?.decision_provenance_required !== true) errors.push("SHADOW_DECISION_PROVENANCE_NOT_REQUIRED");
  if (config?.evidence?.immutable_session_result_required !== true) errors.push("SHADOW_IMMUTABLE_RESULT_NOT_REQUIRED");

  for (const key of REWRITE_RULES) {
    if (config?.decision_rewrite?.[key] !== "PROHIBITED") errors.push(`SHADOW_DECISION_REWRITE_ALLOWED:${key}`);
  }
  if (config?.promotion?.observation_may_recommend !== true) errors.push("SHADOW_RECOMMENDATION_SEMANTICS_INVALID");
  if (config?.promotion?.shadow_evidence_sufficient_for_production_promotion !== false) errors.push("SHADOW_EVIDENCE_GRANTS_PRODUCTION_PROMOTION");
  if (config?.promotion?.shadow_evidence_sufficient_for_live_authorization !== false) errors.push("SHADOW_EVIDENCE_GRANTS_LIVE_AUTHORITY");
  if (config?.promotion?.autonomous_production_mutation !== false) errors.push("SHADOW_AUTONOMOUS_PRODUCTION_MUTATION");

  const implementation = config?.runtime_binding?.implementation;
  const entrypoint = config?.runtime_binding?.verification_entrypoint;
  if (typeof implementation !== "string" || !implementation) errors.push("SHADOW_RUNTIME_BINDING_MISSING");
  if (typeof entrypoint !== "string" || !entrypoint) errors.push("SHADOW_VERIFICATION_ENTRYPOINT_MISSING");

  if (typeof runtimeSource !== "string" || runtimeSource.length === 0) {
    errors.push("SHADOW_RUNTIME_SOURCE_MISSING");
  } else {
    const requiredRuntimeProofs = [
      "actualBrokerCallCount: 0 as const",
      "actualOrderDelta: 0 as const",
      "actualFillDelta: 0 as const",
      "actualCashDelta: 0 as const",
      "actualPositionDelta: 0 as const",
      "SHADOW_MUTATION",
      "verifyShadowPilotEvents",
    ];
    for (const marker of requiredRuntimeProofs) {
      if (!runtimeSource.includes(marker)) errors.push(`SHADOW_RUNTIME_PROOF_MISSING:${marker}`);
    }
    const executionPatterns = [/new\s+PaperBroker\s*\(/, /\.placeOrder\s*\(/, /\.submitOrder\s*\(/, /\.executeOrder\s*\(/];
    if (executionPatterns.some((pattern) => pattern.test(runtimeSource))) errors.push("SHADOW_RUNTIME_EXECUTION_DEPENDENCY");
  }

  return Object.freeze([...new Set(errors)].sort());
}

function loadAndValidate(root = process.cwd()) {
  const configPath = path.join(root, "config", "shadow", "governance.json");
  if (!fs.existsSync(configPath)) return ["SHADOW_GOVERNANCE_CONFIG_MISSING"];
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const implementation = config?.runtime_binding?.implementation;
  const runtimePath = typeof implementation === "string" ? path.join(root, implementation) : "";
  const runtimeSource = runtimePath && fs.existsSync(runtimePath) ? fs.readFileSync(runtimePath, "utf8") : "";
  return validateShadowGovernance(config, runtimeSource);
}

if (require.main === module) {
  const errors = loadAndValidate();
  if (errors.length) {
    console.error("Shadow governance validation FAILED");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log("Shadow governance validation PASS");
  }
}

module.exports = { validateShadowGovernance, loadAndValidate };
