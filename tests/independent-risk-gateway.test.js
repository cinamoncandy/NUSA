const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluatePreTradeRisk, evaluateDeploymentSafety } = require("../dist/apps/desktop/src/risk/independentRiskGateway.js");
const { identity, limits, request, descriptor } = require("./fixtures/risk-gateway-baseline.js");

test("allows a fully healthy Paper request without granting production authority", () => {
  const decision = evaluatePreTradeRisk(request(), identity, limits);
  assert.equal(decision.status, "ALLOW");
  assert.equal(decision.productionMutationAllowed, false);
});

test("halts safety-critical faults before all ordinary rejections", () => {
  const input = request();
  input.controlState.killSwitchActive = true;
  input.marketDataState.status = "STALE";
  input.accountState.cash = 0;
  const decision = evaluatePreTradeRisk(input, identity, limits);
  assert.equal(decision.status, "HALT");
  assert.deepEqual(decision.reasonCodes, ["KILL_SWITCH_ACTIVE", "MARKET_DATA_STALE", "INSUFFICIENT_CASH"]);
});

test("blocks duplicate and exposure requests deterministically", () => {
  const input = request();
  const seen = { ...identity, seenSignalIds: new Set(["s1"]) };
  const decision = evaluatePreTradeRisk(input, seen, limits);
  assert.equal(decision.status, "REJECT");
  assert.deepEqual(decision.reasonCodes, ["DUPLICATE_SIGNAL"]);
});

test("an unverified deployment halts every order", () => {
  const input = request();
  input.deploymentState.integrityVerified = false;
  const decision = evaluatePreTradeRisk(input, identity, limits);
  assert.equal(decision.status, "HALT");
  assert.deepEqual(decision.reasonCodes, ["DEPLOYMENT_INTEGRITY_FAILED"]);
});

test("a missing state block fails closed rather than skipping its checks", () => {
  // A check that cannot read its input must not be indistinguishable from a check that
  // passed: dropping sessionState would otherwise mean the loss and drawdown breakers
  // silently never ran.
  for (const block of ["sessionState", "rateState", "exposureState", "deploymentState"]) {
    const input = request();
    delete input[block];
    const decision = evaluatePreTradeRisk(input, identity, limits);
    assert.equal(decision.status, "HALT", `${block} removal must halt`);
    assert.deepEqual(decision.reasonCodes, ["INVALID_REQUEST"]);
  }
});

test("a null request does not throw and does not allow", () => {
  const decision = evaluatePreTradeRisk(null, identity, limits);
  assert.equal(decision.status, "HALT");
  assert.deepEqual(decision.reasonCodes, ["INVALID_REQUEST"]);
});

test("the gateway never mutates the request it was given", () => {
  const input = request();
  const before = JSON.stringify(input);
  evaluatePreTradeRisk(input, identity, limits);
  assert.equal(JSON.stringify(input), before);
});

test("identical requests produce identical decisions and hashes", () => {
  const first = evaluatePreTradeRisk(request(), identity, limits);
  const second = evaluatePreTradeRisk(request(), identity, limits);
  assert.deepEqual(first, second);
  assert.equal(first.decisionSha256, second.decisionSha256);
});

test("a clean deployment descriptor allows without granting authority", () => {
  const decision = evaluateDeploymentSafety(descriptor());
  assert.equal(decision.status, "ALLOW");
  assert.deepEqual(decision.reasonCodes, []);
  assert.equal(decision.productionMutationAllowed, false);
});

test("every deployment defect halts; there is no degraded-but-allowed deployment", () => {
  const cases = [
    [{ liveTradingCapabilityPresent: true }, "LIVE_TRADING_CAPABILITY_PRESENT"],
    [{ privateApiCapabilityPresent: true }, "PRIVATE_API_CAPABILITY_PRESENT"],
    [{ credentialStoragePresent: true }, "CREDENTIAL_STORAGE_PRESENT"],
    [{ riskGatewayPresent: false }, "RISK_GATEWAY_ABSENT"],
    [{ killSwitchReachable: false }, "KILL_SWITCH_UNREACHABLE"],
    [{ autoTradeDefaultEnabled: true }, "AUTO_TRADE_DEFAULT_ON"],
    [{ artifactSha256: "different" }, "ARTIFACT_HASH_MISMATCH"],
    [{ sourceCommitSha: "different" }, "SOURCE_COMMIT_MISMATCH"],
    [{ persistenceSchemaVersion: 99 }, "PERSISTENCE_SCHEMA_MISMATCH"],
    [{ schemaVersion: 2 }, "INVALID_DESCRIPTOR"]
  ];
  for (const [patch, code] of cases) {
    const decision = evaluateDeploymentSafety({ ...descriptor(), ...patch });
    assert.equal(decision.status, "HALT", `${code} must halt`);
    assert.ok(decision.reasonCodes.includes(code), `${code} must be reported`);
  }
});
