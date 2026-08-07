const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const { evaluateAuthorization, evaluateBreakGlass, runVerification } = require("../scripts/restricted-live-operational-evidence.js");

const policy = JSON.parse(fs.readFileSync("config/live/restricted-live-governance.json", "utf8"));
const now = "2026-08-07T20:20:00+09:00";
const fixture = () => JSON.parse(JSON.stringify(policy.representative_authorization));

test("operational harness passes with zero mutation counters", () => {
  const result = runVerification(policy, now);
  assert.equal(result.result, "PASS");
  assert.deepEqual(result.counters, {
    actualBrokerCallCount: 0,
    credentialAccessCount: 0,
    actualOrderCount: 0,
    actualFillCount: 0,
    actualCashMutationCount: 0,
    actualPositionMutationCount: 0
  });
});

test("duplicate human approvers fail closed", () => {
  const auth = fixture(); auth.approvers[1].principal_id = auth.approvers[0].principal_id;
  assert.equal(evaluateAuthorization(policy, auth, now).pass, false);
});

test("expired authorization fails closed", () => {
  const auth = fixture(); auth.scope.expires_at = "2026-08-07T20:15:00+09:00";
  assert.equal(evaluateAuthorization(policy, auth, now).pass, false);
});

test("safety-critical UNKNOWN fails closed", () => {
  const auth = fixture(); auth.safety.safety_critical_unknown = true;
  assert.equal(evaluateAuthorization(policy, auth, now).pass, false);
});

test("active kill switch fails closed", () => {
  const auth = fixture(); auth.safety.kill_switch_active = true;
  assert.equal(evaluateAuthorization(policy, auth, now).pass, false);
});

test("missing rollback target fails closed", () => {
  const auth = fixture(); auth.scope.rollback_bundle_id = "";
  assert.equal(evaluateAuthorization(policy, auth, now).pass, false);
});

test("automation cannot become human LIVE authority", () => {
  const auth = fixture(); auth.approvers[0].kind = "AUTOMATION";
  assert.equal(evaluateAuthorization(policy, auth, now).pass, false);
});

test("break-glass is risk-reduction only and cannot override safety authorities", () => {
  assert.equal(evaluateBreakGlass(policy).pass, true);
});
