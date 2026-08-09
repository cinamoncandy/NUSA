const test = require("node:test");
const assert = require("node:assert/strict");
const { CanonicalRiskSafetyGate, InMemoryRiskSafetyPersistence } = require("../dist/apps/execution/src/risk-safety-integration.js");
const {
  ORACLE_PAPER_STRATEGY_ID,
  readOraclePaperRiskConfig,
  createOracleCanonicalRiskAdapter
} = require("../dist/apps/cloud/src/oracleRuntime.js");

const baseEnv = Object.freeze({
  NUSA_CLOUD_RISK_POLICY_FINGERPRINT: "policy-v1",
  NUSA_CLOUD_PAPER_MAX_DAILY_LOSS_KRW: "100000",
  NUSA_CLOUD_PAPER_MAX_OPEN_ORDERS: "3",
  NUSA_CLOUD_PAPER_APPROVAL_ID_KRW_BTC: "approval-btc"
});

const evaluationInput = Object.freeze({
  nowMs: 2_000,
  observedAt: 1_900,
  market: "KRW-BTC",
  side: "BUY",
  strategyDecisionAt: 1_800,
  idempotencyKey: "paper:KRW-BTC:1900:BUY:1800",
  currentEquity: 1_000_000,
  marketDataFresh: true,
  marketHealthy: true,
  killSwitchActive: false
});

test("Oracle PAPER risk limits are explicit and fail closed when absent or invalid", () => {
  for (const env of [
    {},
    { ...baseEnv, NUSA_CLOUD_RISK_POLICY_FINGERPRINT: "" },
    { ...baseEnv, NUSA_CLOUD_PAPER_MAX_DAILY_LOSS_KRW: "0" },
    { ...baseEnv, NUSA_CLOUD_PAPER_MAX_OPEN_ORDERS: "1.5" }
  ]) {
    assert.throws(() => readOraclePaperRiskConfig(env));
  }
});

test("market-specific approval IDs are preferred and the generic ID is only a fallback", () => {
  const config = readOraclePaperRiskConfig({ ...baseEnv, NUSA_CLOUD_PAPER_APPROVAL_ID: "fallback" });
  assert.equal(config.approvalIdForMarket("KRW-BTC"), "approval-btc");
  assert.equal(config.approvalIdForMarket("KRW-ETH"), "fallback");
});

test("Oracle adapter uses the current canonical gate and never grants production authority", () => {
  const persistence = new InMemoryRiskSafetyPersistence();
  const gate = new CanonicalRiskSafetyGate(persistence);
  const config = readOraclePaperRiskConfig(baseEnv);
  const adapter = createOracleCanonicalRiskAdapter(gate, config);

  const missing = adapter.evaluate(evaluationInput);
  assert.equal(missing.status, "BLOCKED");
  assert.deepEqual([...missing.reasonCodes], ["APPROVAL_MISSING"]);
  assert.equal(missing.productionMutationAllowed, false);

  gate.saveApproval({
    approvalId: "approval-btc",
    mode: "PAPER",
    symbol: "KRW-BTC",
    strategyId: ORACLE_PAPER_STRATEGY_ID,
    policyFingerprint: "policy-v1",
    expiresAtMs: 10_000,
    approvedBy: "operator",
    approvedAtMs: 1_000
  });
  const approved = adapter.evaluate(evaluationInput);
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.productionMutationAllowed, false);

  const duplicate = adapter.evaluate(evaluationInput);
  assert.equal(duplicate.status, "BLOCKED");
  assert.ok(duplicate.reasonCodes.includes("DUPLICATE_COMMAND"));
});
