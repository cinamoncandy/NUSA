"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { validateRestrictedLiveGovernance } = require("../scripts/validate-restricted-live-governance.js");

const source = JSON.parse(fs.readFileSync(path.join(__dirname, "../config/live/restricted-live-governance.json"), "utf8"));
const clone = () => JSON.parse(JSON.stringify(source));
const rejects = (mutate, code) => { const policy = clone(); mutate(policy); assert.throws(() => validateRestrictedLiveGovernance(policy), (error) => error && error.code === code); };

test("valid Restricted LIVE governance remains disabled and passes", () => {
  const result = validateRestrictedLiveGovernance(clone());
  assert.equal(result.ok, true);
  assert.equal(result.state, "DISABLED");
  assert.equal(result.executionTransportConnected, false);
});

test("execution transport or automatic activation fails closed", () => {
  rejects((p) => { p.execution_transport_connected = true; }, "RESTRICTED_LIVE_EXECUTION_TRANSPORT_PRESENT");
  rejects((p) => { p.automatic_live_activation_allowed = true; }, "RESTRICTED_LIVE_AUTOMATIC_ACTIVATION_ALLOWED");
});

test("risk increase requires exactly two human approvers", () => {
  rejects((p) => { p.representative_authorization.approvers = [p.representative_authorization.approvers[0]]; }, "RESTRICTED_LIVE_TWO_APPROVERS_REQUIRED");
});

test("duplicate approver identity fails closed", () => {
  rejects((p) => { p.representative_authorization.approvers[1].principal_id = p.representative_authorization.approvers[0].principal_id; }, "RESTRICTED_LIVE_APPROVERS_NOT_DISTINCT");
});

test("non-SAFE or UNKNOWN safety evidence fails closed", () => {
  rejects((p) => { p.representative_authorization.safety.operational_state = "RESTRICTED"; }, "RESTRICTED_LIVE_SAFETY_EVIDENCE_INVALID");
  rejects((p) => { p.representative_authorization.safety.safety_critical_unknown = true; }, "RESTRICTED_LIVE_SAFETY_EVIDENCE_INVALID");
});

test("unbounded or invalid time scope fails closed", () => {
  rejects((p) => { p.representative_authorization.scope.max_order_notional = 0; }, "RESTRICTED_LIVE_SCOPE_UNBOUNDED");
  rejects((p) => { p.representative_authorization.scope.expires_at = p.representative_authorization.scope.starts_at; }, "RESTRICTED_LIVE_TIME_SCOPE_INVALID");
});

test("AI, Meta-AI, Shadow, or promotion evidence cannot grant LIVE authority", () => {
  rejects((p) => { p.representative_authorization.ai_authority_allowed = true; }, "RESTRICTED_LIVE_FORBIDDEN_AUTHORITY_ENABLED");
  rejects((p) => { p.representative_authorization.shadow_evidence_grants_authority = true; }, "RESTRICTED_LIVE_FORBIDDEN_AUTHORITY_ENABLED");
});

test("break-glass may only reduce risk and cannot override hard safety", () => {
  rejects((p) => { p.break_glass.may_increase_risk = true; }, "RESTRICTED_LIVE_BREAK_GLASS_INVALID");
  rejects((p) => { p.break_glass.may_override_kill_switch = true; }, "RESTRICTED_LIVE_BREAK_GLASS_INVALID");
});
