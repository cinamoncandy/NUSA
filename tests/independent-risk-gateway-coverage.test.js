const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { evaluatePreTradeRisk, evaluateDeploymentSafety, RISK_REASON_ORDER, DEPLOYMENT_REASON_ORDER } = require("../dist/apps/desktop/src/risk/independentRiskGateway.js");
const { verifyPreTradeRiskDecision, verifyDeploymentSafetyDecision, REASON_ORDER, DEPLOYMENT_ORDER } = require("../scripts/lib/paper-risk-gateway-verifier.js");
const { identity, limits, request, descriptor } = require("./fixtures/risk-gateway-baseline.js");

const withIdentity = (patch) => ({ ...identity, ...patch });

/**
 * One crafted case per declared reason code. The point of this table is not the individual
 * assertions but the completeness check below it: a code that no case can produce is a
 * limit the contract advertises and the gateway never enforces.
 */
const CASES = [
  ["INVALID_REQUEST", (r) => { r.schemaVersion = 2; }],
  ["LIVE_CAPABILITY_DETECTED", (r) => { r.controlState.liveCapabilityDetected = true; }],
  ["PRIVATE_API_CAPABILITY_DETECTED", (r) => { r.controlState.privateApiCapabilityDetected = true; }],
  ["DEPLOYMENT_INTEGRITY_FAILED", (r) => { r.deploymentState.integrityVerified = false; }],
  ["KILL_SWITCH_ACTIVE", (r) => { r.controlState.killSwitchActive = true; }],
  ["STRATEGY_FINGERPRINT_MISMATCH", (r) => { r.strategyFingerprint = "other"; }],
  ["CONFIG_FINGERPRINT_MISMATCH", (r) => { r.configFingerprint = "other"; }],
  ["RUNTIME_FINGERPRINT_MISMATCH", (r) => { r.runtimeFingerprint = "other"; }],
  ["RISK_POLICY_FINGERPRINT_MISMATCH", (r) => { r.riskPolicyFingerprint = "other"; }],
  ["APPROVAL_MISSING", (r) => { r.approvalState.approved = false; }],
  ["APPROVAL_EXPIRED", (r) => { r.approvalState.expiresAt = 5; }],
  ["APPROVAL_SCOPE_MISMATCH", (r) => { r.approvalState.symbols = ["KRW-ETH"]; }],
  ["PERSISTENCE_UNHEALTHY", (r) => { r.persistenceState.healthy = false; }],
  ["RECONCILIATION_FAILED", (r) => { r.reconciliationState.healthy = false; }],
  ["OPEN_P0_ALERT", (r) => { r.reconciliationState.openP0 = true; }],
  ["MARKET_DATA_STALE", (r) => { r.marketDataState.status = "STALE"; }],
  ["MARKET_DATA_RECONNECTING", (r) => { r.marketDataState.status = "RECONNECTING"; }],
  ["MARKET_DATA_WARMING_UP", (r) => { r.marketDataState.status = "WARMING_UP"; }],
  ["MARKET_DATA_GAP", (r) => { r.marketDataState.status = "GAP_DETECTED"; }],
  ["MARKET_DATA_OUT_OF_ORDER", (r) => { r.marketDataState.status = "OUT_OF_ORDER"; }],
  ["MARKET_DATA_INVALID", (r) => { r.marketDataState.status = "INVALID"; }],
  ["PRICE_DEVIATION_LIMIT", (r) => { r.marketDataState.price = 5; }],
  ["DUPLICATE_SIGNAL", null, withIdentity({ seenSignalIds: new Set(["s1"]) })],
  ["DUPLICATE_COMMAND", null, withIdentity({ seenCommandIds: new Set(["c1"]) })],
  ["DUPLICATE_CLIENT_ORDER_ID", null, withIdentity({ seenClientOrderIds: new Set(["o1"]) })],
  ["ORDER_RATE_LIMIT_PER_SECOND", (r) => { r.rateState.ordersInLastSecond = 3; }],
  ["ORDER_RATE_LIMIT_PER_MINUTE", (r) => { r.rateState.ordersInLastMinute = 30; }],
  ["SAME_SIDE_BURST_LIMIT", (r) => { r.rateState.sameSideStreak = 5; }],
  ["OPEN_ORDER_LIMIT", (r) => { r.accountState.openOrderCount = 1; }],
  ["MAX_ORDER_NOTIONAL", (r) => { r.quantity = 10; }],
  ["MAX_POSITION_NOTIONAL", (r) => { r.accountState.positionQuantity = 10; }],
  ["MAX_SYMBOL_EXPOSURE", (r) => { r.exposureState.symbolExposureNotional = 495; }],
  ["MAX_PORTFOLIO_EXPOSURE", (r) => { r.exposureState.portfolioExposureNotional = 995; }],
  ["MAX_DAILY_BUY_NOTIONAL", (r) => { r.exposureState.dailyBuyNotional = 495; }],
  ["MAX_DAILY_SELL_NOTIONAL", (r) => { r.side = "SELL"; r.accountState.positionQuantity = 5; r.exposureState.dailySellNotional = 495; }],
  ["INSUFFICIENT_CASH", (r) => { r.accountState.cash = 0; }],
  ["INSUFFICIENT_POSITION", (r) => { r.side = "SELL"; }],
  ["DAILY_LOSS_LIMIT", (r) => { r.sessionState.dailyRealizedPnL = -50; }],
  ["CONSECUTIVE_LOSS_LIMIT", (r) => { r.sessionState.consecutiveLossCount = 5; }],
  ["SESSION_DRAWDOWN_LIMIT", (r) => { r.sessionState.sessionEquity = 80; }]
];

const build = ([, mutate, override]) => {
  const input = request();
  if (mutate) mutate(input);
  return { input, identity: override ?? identity };
};

test("the evaluation order is exactly the contract's declared reason-code union", () => {
  // Guards against a code being added to the contract type and never wired into the
  // evaluator -- which is the failure this whole file exists to prevent.
  const source = fs.readFileSync(path.join(__dirname, "..", "packages", "contracts", "src", "riskGateway.ts"), "utf8");
  const block = source.slice(source.indexOf("export type RiskReasonCode"), source.indexOf("export type MarketDataStatus"));
  const declared = [...block.matchAll(/"([A-Z0-9_]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...RISK_REASON_ORDER].sort(), [...declared].sort());
  assert.deepEqual([...REASON_ORDER], [...RISK_REASON_ORDER], "the verifier's order must match the evaluator's");
});

test("every declared reason code is reachable by some request", () => {
  const covered = new Set();
  for (const testCase of CASES) {
    const [code] = testCase;
    const { input, identity: id } = build(testCase);
    const decision = evaluatePreTradeRisk(input, id, limits);
    assert.ok(decision.reasonCodes.includes(code), `${code} was not produced by its own case (got ${JSON.stringify(decision.reasonCodes)})`);
    assert.notEqual(decision.status, "ALLOW", `${code} must not ALLOW`);
    covered.add(code);
  }
  const unreachable = RISK_REASON_ORDER.filter((code) => !covered.has(code));
  assert.deepEqual(unreachable, [], `unenforced reason codes: ${unreachable.join(", ")}`);
});

test("the independent verifier agrees with the evaluator on every case", () => {
  for (const testCase of CASES) {
    const { input, identity: id } = build(testCase);
    const decision = evaluatePreTradeRisk(input, id, limits);
    const verification = verifyPreTradeRiskDecision(input, id, limits, decision);
    assert.equal(verification.status, "PASS", `${testCase[0]}: ${JSON.stringify(verification.errors)}`);
  }
  const clean = evaluatePreTradeRisk(request(), identity, limits);
  assert.equal(verifyPreTradeRiskDecision(request(), identity, limits, clean).status, "PASS");
});

test("safety-critical codes halt and ordinary limit codes reject", () => {
  const boundary = RISK_REASON_ORDER.indexOf("OPEN_P0_ALERT");
  for (const testCase of CASES) {
    const [code] = testCase;
    const { input, identity: id } = build(testCase);
    const decision = evaluatePreTradeRisk(input, id, limits);
    const anyHalting = decision.reasonCodes.some((reported) => RISK_REASON_ORDER.indexOf(reported) <= boundary);
    assert.equal(decision.status, anyHalting ? "HALT" : "REJECT", `${code} produced ${decision.status}`);
  }
});

test("the verifier catches a decision that was upgraded to ALLOW after the fact", () => {
  const input = request();
  input.controlState.killSwitchActive = true;
  const decision = { ...evaluatePreTradeRisk(input, identity, limits), status: "ALLOW", reasonCodes: [] };
  const verification = verifyPreTradeRiskDecision(input, identity, limits, decision);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((error) => error.includes("KILL_SWITCH_ACTIVE")));
});

test("the verifier catches a decision that grants production authority", () => {
  const decision = { ...evaluatePreTradeRisk(request(), identity, limits), productionMutationAllowed: true };
  const verification = verifyPreTradeRiskDecision(request(), identity, limits, decision);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((error) => error.includes("production mutation")));
});

test("the verifier catches reason codes reported out of severity order", () => {
  const input = request();
  input.controlState.killSwitchActive = true;
  input.accountState.cash = 0;
  const decision = evaluatePreTradeRisk(input, identity, limits);
  const scrambled = { ...decision, reasonCodes: [...decision.reasonCodes].reverse() };
  const verification = verifyPreTradeRiskDecision(input, identity, limits, scrambled);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((error) => error.includes("canonical severity order")));
});

test("every declared deployment reason code is reachable and independently verified", () => {
  const cases = [
    ["INVALID_DESCRIPTOR", { schemaVersion: 2 }],
    ["LIVE_TRADING_CAPABILITY_PRESENT", { liveTradingCapabilityPresent: true }],
    ["PRIVATE_API_CAPABILITY_PRESENT", { privateApiCapabilityPresent: true }],
    ["CREDENTIAL_STORAGE_PRESENT", { credentialStoragePresent: true }],
    ["RISK_GATEWAY_ABSENT", { riskGatewayPresent: false }],
    ["KILL_SWITCH_UNREACHABLE", { killSwitchReachable: false }],
    ["AUTO_TRADE_DEFAULT_ON", { autoTradeDefaultEnabled: true }],
    ["ARTIFACT_HASH_MISMATCH", { artifactSha256: "other" }],
    ["SOURCE_COMMIT_MISMATCH", { sourceCommitSha: "other" }],
    ["PERSISTENCE_SCHEMA_MISMATCH", { persistenceSchemaVersion: 99 }]
  ];
  assert.deepEqual([...DEPLOYMENT_ORDER], [...DEPLOYMENT_REASON_ORDER]);
  const covered = new Set();
  for (const [code, patch] of cases) {
    const input = { ...descriptor(), ...patch };
    const decision = evaluateDeploymentSafety(input);
    assert.ok(decision.reasonCodes.includes(code), `${code} was not produced`);
    assert.equal(decision.status, "HALT");
    assert.equal(verifyDeploymentSafetyDecision(input, decision).status, "PASS", code);
    covered.add(code);
  }
  assert.deepEqual(DEPLOYMENT_REASON_ORDER.filter((code) => !covered.has(code)), []);
  assert.equal(verifyDeploymentSafetyDecision(descriptor(), evaluateDeploymentSafety(descriptor())).status, "PASS");
});
