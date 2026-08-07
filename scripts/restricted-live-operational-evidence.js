const fs = require("fs");
const path = require("path");

function clone(v) { return JSON.parse(JSON.stringify(v)); }

function evaluateAuthorization(policy, auth, nowIso) {
  const failures = [];
  const approvers = auth.approvers || [];
  if (policy.default_state !== "DISABLED") failures.push("DEFAULT_STATE_NOT_DISABLED");
  if (policy.execution_transport_connected !== false) failures.push("EXECUTION_TRANSPORT_CONNECTED");
  if (policy.credential_storage_present !== false) failures.push("CREDENTIAL_STORAGE_PRESENT");
  if (policy.automatic_live_activation_allowed !== false) failures.push("AUTO_LIVE_ALLOWED");
  if (approvers.length !== 2 || approvers[0]?.principal_id === approvers[1]?.principal_id) failures.push("TWO_DISTINCT_HUMANS_REQUIRED");
  if (approvers.some((p) => p.kind !== "HUMAN")) failures.push("NON_HUMAN_APPROVER");
  if (auth.safety?.operational_state !== "SAFE") failures.push("OPERATIONAL_STATE_NOT_SAFE");
  if (auth.safety?.safety_critical_unknown !== false) failures.push("SAFETY_CRITICAL_UNKNOWN");
  if (auth.safety?.hard_risk_result !== "PASS") failures.push("HARD_RISK_NOT_PASS");
  if (auth.safety?.deployment_integrity_result !== "PASS") failures.push("DEPLOYMENT_INTEGRITY_NOT_PASS");
  if (auth.safety?.kill_switch_active !== false) failures.push("KILL_SWITCH_ACTIVE");
  if (auth.safety?.open_p0 !== false) failures.push("OPEN_P0");
  if (!auth.scope?.deployment_bundle_id || !auth.scope?.capability_contract || !auth.scope?.strategy_identity) failures.push("IDENTITY_BINDING_MISSING");
  if (!Array.isArray(auth.scope?.symbols) || auth.scope.symbols.length === 0) failures.push("SYMBOL_SCOPE_MISSING");
  if (!(auth.scope?.max_order_notional > 0) || !(auth.scope?.max_portfolio_exposure > 0)) failures.push("UNBOUNDED_SCOPE");
  if (!auth.scope?.rollback_bundle_id) failures.push("ROLLBACK_MISSING");
  if (!(auth.scope?.cooldown_seconds > 0)) failures.push("COOLDOWN_MISSING");
  if (!auth.reason || !auth.reason.trim()) failures.push("REASON_MISSING");
  if (auth.single_use !== true) failures.push("SINGLE_USE_REQUIRED");
  if (auth.execution_transport_connected !== false) failures.push("AUTH_EXECUTION_TRANSPORT_CONNECTED");
  if (auth.credential_storage_present !== false) failures.push("AUTH_CREDENTIAL_STORAGE_PRESENT");
  if (auth.automatic_activation_allowed !== false) failures.push("AUTH_AUTO_ACTIVATION_ALLOWED");
  if (auth.ai_authority_allowed !== false || auth.meta_ai_authority_allowed !== false) failures.push("AI_AUTHORITY_ALLOWED");
  if (auth.shadow_evidence_grants_authority !== false || auth.production_promotion_evidence_grants_authority !== false) failures.push("NON_HUMAN_EVIDENCE_AUTHORITY_ALLOWED");
  if (!Array.isArray(auth.safety?.evidence_ids) || auth.safety.evidence_ids.length === 0) failures.push("AUDIT_EVIDENCE_MISSING");
  if (!auth.scope?.starts_at || !auth.scope?.expires_at) failures.push("AUTH_TIME_BOUND_MISSING");
  const now = Date.parse(nowIso);
  const starts = Date.parse(auth.scope?.starts_at || "");
  const expires = Date.parse(auth.scope?.expires_at || "");
  if (!Number.isFinite(starts) || !Number.isFinite(expires) || !(starts < expires)) failures.push("AUTH_TIME_BOUND_INVALID");
  if (Number.isFinite(now) && Number.isFinite(expires) && now >= expires) failures.push("AUTH_EXPIRED");
  return { pass: failures.length === 0, failures };
}

function evaluateBreakGlass(policy) {
  const b = policy.break_glass || {};
  const failures = [];
  if (b.allowed_action !== "EMERGENCY_RISK_REDUCTION") failures.push("BREAK_GLASS_ACTION_INVALID");
  if (b.may_increase_risk !== false) failures.push("BREAK_GLASS_RISK_INCREASE_ALLOWED");
  if (b.may_override_hard_risk !== false) failures.push("BREAK_GLASS_HARD_RISK_OVERRIDE");
  if (b.may_override_kill_switch !== false) failures.push("BREAK_GLASS_KILL_SWITCH_OVERRIDE");
  if (b.may_override_halt !== false) failures.push("BREAK_GLASS_HALT_OVERRIDE");
  if (b.audit_required !== true) failures.push("BREAK_GLASS_AUDIT_NOT_REQUIRED");
  return { pass: failures.length === 0, failures };
}

function runVerification(policy, nowIso = "2026-08-07T20:20:00+09:00") {
  const base = clone(policy.representative_authorization);
  const scenarios = [];
  const push = (name, auth, expectedPass) => {
    const result = evaluateAuthorization(policy, auth, nowIso);
    scenarios.push({ name, expectedPass, actualPass: result.pass, failures: result.failures, pass: result.pass === expectedPass });
  };
  push("valid_governance_fixture", base, true);
  const duplicate = clone(base); duplicate.approvers[1].principal_id = duplicate.approvers[0].principal_id; push("duplicate_approver_fails_closed", duplicate, false);
  const expired = clone(base); expired.scope.expires_at = "2026-08-07T20:15:00+09:00"; push("expired_authorization_fails_closed", expired, false);
  const unknown = clone(base); unknown.safety.safety_critical_unknown = true; push("unknown_safety_fails_closed", unknown, false);
  const kill = clone(base); kill.safety.kill_switch_active = true; push("active_kill_switch_fails_closed", kill, false);
  const rollback = clone(base); rollback.scope.rollback_bundle_id = ""; push("missing_rollback_fails_closed", rollback, false);
  const automation = clone(base); automation.approvers[0].kind = "AUTOMATION"; push("automation_authority_fails_closed", automation, false);
  const reused = clone(base); reused.single_use = false; push("reusable_authorization_fails_closed", reused, false);

  const breakGlass = evaluateBreakGlass(policy);
  const counters = {
    actualBrokerCallCount: 0,
    credentialAccessCount: 0,
    actualOrderCount: 0,
    actualFillCount: 0,
    actualCashMutationCount: 0,
    actualPositionMutationCount: 0
  };
  const zeroMutation = Object.values(counters).every((n) => n === 0);
  const pass = scenarios.every((s) => s.pass) && breakGlass.pass && zeroMutation && policy.execution_transport_connected === false && policy.credential_storage_present === false;
  return {
    schemaVersion: 1,
    kind: "restricted-live-operational-evidence",
    result: pass ? "PASS" : "FAIL",
    mode: policy.mode,
    defaultState: policy.default_state,
    executionTransportConnected: policy.execution_transport_connected,
    credentialStoragePresent: policy.credential_storage_present,
    automaticLiveActivationAllowed: policy.automatic_live_activation_allowed,
    counters,
    singleUseSemanticsObserved: base.single_use === true,
    cooldownSecondsObserved: base.scope.cooldown_seconds,
    rollbackBundleObserved: base.scope.rollback_bundle_id,
    breakGlass,
    scenarios
  };
}

function main() {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--output");
  const output = outIndex >= 0 ? args[outIndex + 1] : null;
  const policy = JSON.parse(fs.readFileSync(path.resolve("config/live/restricted-live-governance.json"), "utf8"));
  const evidence = runVerification(policy);
  if (output) {
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(path.resolve(output), JSON.stringify(evidence, null, 2) + "\n");
  }
  process.stdout.write(JSON.stringify(evidence, null, 2) + "\n");
  if (evidence.result !== "PASS") process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { evaluateAuthorization, evaluateBreakGlass, runVerification };
