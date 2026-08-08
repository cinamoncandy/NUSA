"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  RESTRICTED_LIVE_ENVIRONMENT_PREFLIGHT_DESCRIPTOR,
  evaluateRestrictedLiveEnvironmentPreflight
} = require("../dist/apps/execution/src/index.js");
const { validateRestrictedLiveEnvironmentPreflight } = require("../scripts/validate-restricted-live-environment-preflight.js");

const REV = "8".repeat(40);
const CFG = "9".repeat(64);

function safe(overrides = {}) {
  return {
    codeRevision: REV,
    configurationHash: CFG,
    evidenceRefs: ["evidence:capability", "evidence:restore", "evidence:risk"],
    restoreVerification: "PASS",
    auditReplay: "VALID",
    readOnlyBroker: "PASS",
    reconciliation: "MATCH",
    marketDataHealth: "HEALTHY",
    hardRisk: "PASS",
    killSwitch: "INACTIVE",
    governanceState: "RESTRICTED",
    operationalState: "SAFE",
    capabilitySurface: "PASS",
    executionTransportConnected: false,
    executionCredentialUseEnabled: false,
    realMoneyExecutionAllowed: false,
    automaticActivationAllowed: false,
    mutationCapabilityPresent: false,
    readOnlyTransportMode: "OPERATOR_INITIATED",
    requiredHumanApprovers: 2,
    distinctHumanApproversRequired: true,
    rollbackTargetPresent: true,
    expiryRequired: true,
    cooldownRequired: true,
    exactScopeRequired: true,
    mutationCounters: { brokerCalls: 0, orders: 0, fills: 0, cash: 0, positions: 0 },
    ...overrides
  };
}

test("safe synthetic evidence is ready for human review only", () => {
  const result = evaluateRestrictedLiveEnvironmentPreflight(safe());
  assert.equal(result.verdict, "READY_FOR_HUMAN_REVIEW");
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.unknowns, []);
  assert.equal(result.executionAuthority, false);
  assert.equal(result.authorizesLive, false);
  assert.equal(result.networkDialPerformed, false);
  assert.equal(result.executionCredentialUse, false);
  assert.equal(result.realMoneyExecutionAllowed, false);
});

test("identical normalized evidence yields identical fingerprint", () => {
  const left = evaluateRestrictedLiveEnvironmentPreflight(safe({ evidenceRefs: ["evidence:z", "evidence:a"] }));
  const right = evaluateRestrictedLiveEnvironmentPreflight(safe({ evidenceRefs: ["evidence:a", "evidence:z"] }));
  assert.equal(left.fingerprint, right.fingerprint);
  assert.deepEqual(left.evidenceRefs, ["evidence:a", "evidence:z"]);
});

test("execution or mutation conditions always safe-block", () => {
  const cases = [
    { executionTransportConnected: true },
    { executionCredentialUseEnabled: true },
    { realMoneyExecutionAllowed: true },
    { automaticActivationAllowed: true },
    { mutationCapabilityPresent: true },
    { mutationCounters: { brokerCalls: 0, orders: 1, fills: 0, cash: 0, positions: 0 } },
    { reconciliation: "DIFF" },
    { hardRisk: "BLOCK" },
    { killSwitch: "ACTIVE" },
    { governanceState: "ACTIVE" }
  ];
  for (const override of cases) assert.equal(evaluateRestrictedLiveEnvironmentPreflight(safe(override)).verdict, "SAFE_BLOCK");
});

test("safety-critical unknown stays unknown and fail-closed", () => {
  const cases = [
    { restoreVerification: "UNKNOWN" },
    { auditReplay: "UNKNOWN" },
    { reconciliation: "UNKNOWN" },
    { marketDataHealth: "UNKNOWN" },
    { hardRisk: "UNKNOWN" },
    { killSwitch: "UNKNOWN" },
    { operationalState: "UNKNOWN" },
    { capabilitySurface: "UNKNOWN" }
  ];
  for (const override of cases) {
    const result = evaluateRestrictedLiveEnvironmentPreflight(safe(override));
    assert.equal(result.verdict, "UNKNOWN");
    assert.ok(result.unknowns.length > 0);
    assert.equal(result.authorizesLive, false);
  }
});

test("later ceremony controls are mandatory even for human-review readiness", () => {
  assert.equal(evaluateRestrictedLiveEnvironmentPreflight(safe({ requiredHumanApprovers: 1 })).verdict, "SAFE_BLOCK");
  assert.equal(evaluateRestrictedLiveEnvironmentPreflight(safe({ distinctHumanApproversRequired: false })).verdict, "SAFE_BLOCK");
  assert.equal(evaluateRestrictedLiveEnvironmentPreflight(safe({ rollbackTargetPresent: false })).verdict, "SAFE_BLOCK");
  assert.equal(evaluateRestrictedLiveEnvironmentPreflight(safe({ expiryRequired: false })).verdict, "SAFE_BLOCK");
  assert.equal(evaluateRestrictedLiveEnvironmentPreflight(safe({ cooldownRequired: false })).verdict, "SAFE_BLOCK");
  assert.equal(evaluateRestrictedLiveEnvironmentPreflight(safe({ exactScopeRequired: false })).verdict, "SAFE_BLOCK");
});

test("malformed identity or sensitive evidence reference fails closed by exception", () => {
  assert.throws(() => evaluateRestrictedLiveEnvironmentPreflight(safe({ codeRevision: "bad" })), /CODE_REVISION_INVALID/);
  const marker = ["Bearer", "synthetic-material"].join(" ");
  assert.throws(() => evaluateRestrictedLiveEnvironmentPreflight(safe({ evidenceRefs: [marker] })), /EVIDENCE_REF_INVALID/);
  assert.throws(() => evaluateRestrictedLiveEnvironmentPreflight(safe({ evidenceRefs: ["evidence:a", "evidence:a"] })), /EVIDENCE_REF_DUPLICATE/);
});

test("source guard proves preflight has no execution surface", () => {
  const result = validateRestrictedLiveEnvironmentPreflight();
  assert.equal(result.ok, true, result.failures.join(","));
  assert.equal(RESTRICTED_LIVE_ENVIRONMENT_PREFLIGHT_DESCRIPTOR.networkDialAllowed, false);
  assert.equal(RESTRICTED_LIVE_ENVIRONMENT_PREFLIGHT_DESCRIPTOR.executionAuthority, false);
  assert.equal(RESTRICTED_LIVE_ENVIRONMENT_PREFLIGHT_DESCRIPTOR.authorizesLive, false);
  assert.equal(RESTRICTED_LIVE_ENVIRONMENT_PREFLIGHT_DESCRIPTOR.realMoneyExecutionAllowed, false);
});
