"use strict";
const fs = require("node:fs");
const path = require("node:path");

function fail(code, detail) { const error = new Error(`${code}${detail ? `: ${detail}` : ""}`); error.code = code; throw error; }
function nonEmpty(value) { return typeof value === "string" && value.trim().length > 0; }
function finitePositive(value) { return typeof value === "number" && Number.isFinite(value) && value > 0; }

function validateRestrictedLiveGovernance(policy) {
  if (!policy || policy.schema_version !== 1) fail("RESTRICTED_LIVE_SCHEMA_INVALID");
  if (policy.mode !== "RESTRICTED_LIVE_GOVERNANCE_ONLY") fail("RESTRICTED_LIVE_MODE_INVALID");
  if (policy.default_state !== "DISABLED") fail("RESTRICTED_LIVE_DEFAULT_NOT_DISABLED");
  if (policy.execution_transport_connected !== false) fail("RESTRICTED_LIVE_EXECUTION_TRANSPORT_PRESENT");
  if (policy.credential_storage_present !== false) fail("RESTRICTED_LIVE_CREDENTIAL_STORAGE_PRESENT");
  if (policy.automatic_live_activation_allowed !== false) fail("RESTRICTED_LIVE_AUTOMATIC_ACTIVATION_ALLOWED");

  const authorities = policy.authorities || {};
  if (authorities.live !== "human-live-authority") fail("RESTRICTED_LIVE_HUMAN_AUTHORITY_INVALID");
  if (authorities.hard_risk !== "hard-risk-governor") fail("RESTRICTED_LIVE_HARD_RISK_AUTHORITY_INVALID");
  if (authorities.kill_switch !== "independent-kill-switch-authority") fail("RESTRICTED_LIVE_KILL_SWITCH_AUTHORITY_INVALID");
  if (authorities.production_promotion !== "human-production-promotion-authority") fail("RESTRICTED_LIVE_PROMOTION_AUTHORITY_INVALID");

  const req = policy.requirements || {};
  const requiredTrue = ["risk_increase_requires_two_distinct_humans","safety_critical_unknown_must_be_false","kill_switch_must_be_inactive","open_p0_must_be_false","authorization_single_use","bounded_scope_required","expiry_required","cooldown_required","verified_rollback_required","reason_required","audit_evidence_required"];
  for (const key of requiredTrue) if (req[key] !== true) fail("RESTRICTED_LIVE_REQUIREMENT_MISSING", key);
  if (req.operational_state_required !== "SAFE" || req.hard_risk_result_required !== "PASS" || req.deployment_integrity_required !== "PASS") fail("RESTRICTED_LIVE_SAFETY_REQUIREMENT_INVALID");

  const prohibitions = new Set(policy.prohibitions || []);
  for (const value of ["ai_live_authority","meta_ai_live_authority","shadow_evidence_live_authority","promotion_evidence_live_authority","ci_live_authority","automation_live_authority","single_person_risk_increase","duplicate_approver_identity","unbounded_live_scope","expired_live_authorization","hard_risk_override","kill_switch_override","halt_override","break_glass_risk_increase"]) if (!prohibitions.has(value)) fail("RESTRICTED_LIVE_PROHIBITION_MISSING", value);

  const bg = policy.break_glass || {};
  if (bg.allowed_action !== "EMERGENCY_RISK_REDUCTION" || bg.may_increase_risk !== false || bg.may_override_hard_risk !== false || bg.may_override_kill_switch !== false || bg.may_override_halt !== false || bg.audit_required !== true) fail("RESTRICTED_LIVE_BREAK_GLASS_INVALID");

  const auth = policy.representative_authorization || {};
  if (auth.state !== "DISABLED") fail("RESTRICTED_LIVE_FIXTURE_MUST_REMAIN_DISABLED");
  if (!nonEmpty(auth.authorization_id) || !nonEmpty(auth.reason)) fail("RESTRICTED_LIVE_AUTHORIZATION_IDENTITY_INVALID");
  if (auth.action !== "RISK_INCREASE") fail("RESTRICTED_LIVE_ACTION_INVALID");
  if (!auth.requester || auth.requester.kind !== "HUMAN" || !nonEmpty(auth.requester.principal_id)) fail("RESTRICTED_LIVE_REQUESTER_INVALID");
  if (!Array.isArray(auth.approvers) || auth.approvers.length !== 2) fail("RESTRICTED_LIVE_TWO_APPROVERS_REQUIRED");
  const approverIds = auth.approvers.map((p) => p && p.kind === "HUMAN" ? p.principal_id : null);
  if (approverIds.some((id) => !nonEmpty(id)) || new Set(approverIds).size !== 2) fail("RESTRICTED_LIVE_APPROVERS_NOT_DISTINCT");

  const scope = auth.scope || {};
  if (![scope.deployment_bundle_id, scope.capability_contract, scope.strategy_identity, scope.rollback_bundle_id].every(nonEmpty)) fail("RESTRICTED_LIVE_SCOPE_IDENTITY_MISSING");
  if (!Array.isArray(scope.symbols) || scope.symbols.length === 0 || scope.symbols.some((s) => !nonEmpty(s))) fail("RESTRICTED_LIVE_SYMBOL_SCOPE_INVALID");
  if (!finitePositive(scope.max_order_notional) || !finitePositive(scope.max_portfolio_exposure) || !Number.isInteger(scope.cooldown_seconds) || scope.cooldown_seconds <= 0) fail("RESTRICTED_LIVE_SCOPE_UNBOUNDED");
  const issued = Date.parse(auth.issued_at), starts = Date.parse(scope.starts_at), expires = Date.parse(scope.expires_at);
  if (![issued, starts, expires].every(Number.isFinite) || starts < issued || expires <= starts) fail("RESTRICTED_LIVE_TIME_SCOPE_INVALID");

  const safety = auth.safety || {};
  if (safety.operational_state !== "SAFE" || safety.safety_critical_unknown !== false || safety.hard_risk_result !== "PASS" || safety.deployment_integrity_result !== "PASS" || safety.kill_switch_active !== false || safety.open_p0 !== false || !Array.isArray(safety.evidence_ids) || safety.evidence_ids.length === 0) fail("RESTRICTED_LIVE_SAFETY_EVIDENCE_INVALID");
  for (const key of ["single_use"]) if (auth[key] !== true) fail("RESTRICTED_LIVE_SINGLE_USE_REQUIRED");
  for (const key of ["execution_transport_connected","credential_storage_present","automatic_activation_allowed","ai_authority_allowed","meta_ai_authority_allowed","shadow_evidence_grants_authority","production_promotion_evidence_grants_authority"]) if (auth[key] !== false) fail("RESTRICTED_LIVE_FORBIDDEN_AUTHORITY_ENABLED", key);

  return { ok: true, mode: policy.mode, state: auth.state, executionTransportConnected: false };
}

function main() {
  const target = process.argv[2] || path.join(process.cwd(), "config/live/restricted-live-governance.json");
  const policy = JSON.parse(fs.readFileSync(target, "utf8"));
  const result = validateRestrictedLiveGovernance(policy);
  console.log(`Restricted LIVE governance PASS (${result.mode}, fixture=${result.state}, transport=disconnected)`);
}
if (require.main === module) main();
module.exports = { validateRestrictedLiveGovernance };
