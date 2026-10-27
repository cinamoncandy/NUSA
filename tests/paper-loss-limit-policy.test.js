const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluatePreTradeRisk } = require("../dist/packages/core/src/independentRiskGateway.js");
const { identity, limits, request } = require("./fixtures/risk-gateway-baseline.js");
const { CLOUD_PAPER_RISK_LIMITS } = require("../dist/apps/cloud/src/cloudPaperCanonicalRiskGateway.js");
const { verifyPreTradeRiskDecision } = require("../scripts/lib/paper-risk-gateway-verifier.js");

test("owner Cloud PAPER policy disables only the consecutive-loss veto", () => {
  assert.equal(CLOUD_PAPER_RISK_LIMITS.consecutiveLossLimitEnabled, false);
  const r = request();
  r.sessionState.consecutiveLossCount = limits.maxConsecutiveLosses + 10;
  assert.ok(evaluatePreTradeRisk(r, identity, limits).reasonCodes.includes("CONSECUTIVE_LOSS_LIMIT"));
  const disabled = { ...limits, consecutiveLossLimitEnabled: false };
  assert.equal(evaluatePreTradeRisk(r, identity, disabled).status, "ALLOW");
  assert.equal(verifyPreTradeRiskDecision(r, identity, disabled, evaluatePreTradeRisk(r, identity, disabled)).status, "PASS");
  assert.equal(r.sessionState.consecutiveLossCount, limits.maxConsecutiveLosses + 10);
  r.controlState.killSwitchActive = true;
  assert.ok(evaluatePreTradeRisk(r, identity, disabled).reasonCodes.includes("KILL_SWITCH_ACTIVE"));
  r.controlState.killSwitchActive = false;
  r.sessionState.dailyRealizedPnL = -limits.maxDailyLoss - 1;
  assert.ok(evaluatePreTradeRisk(r, identity, disabled).reasonCodes.includes("DAILY_LOSS_LIMIT"));
});

test("unknown loss-policy values fail closed and LIVE capability is never authorized", () => {
  for (const value of [null, "false", 0, {}, []]) {
    const r = request();
    const policy = { ...limits, consecutiveLossLimitEnabled: value };
    const result = evaluatePreTradeRisk(r, identity, policy);
    assert.equal(result.status, "HALT");
    assert.equal(verifyPreTradeRiskDecision(r, identity, policy, result).status, "PASS");
  }
  const r = request();
  r.controlState.liveCapabilityDetected = true;
  assert.ok(evaluatePreTradeRisk(r, identity, { ...limits, consecutiveLossLimitEnabled: false }).reasonCodes.includes("LIVE_CAPABILITY_DETECTED"));
});
