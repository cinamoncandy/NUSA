const test = require("node:test");
const assert = require("node:assert/strict");
const { preserveCapital } = require("../dist/apps/cloud/src/capitalPreservationEngine.js");

const base = (overrides = {}) => ({ totalEquity: 1000, drawdown: 0.1, dailyLoss: 0.01, monthlyLoss: 0.02, maximumDrawdown: 0.4, dailyLossLimit: 0.1, monthlyLossLimit: 0.2, recoveryUncertain: false, killSwitchActive: false, ...overrides });

test("preserves or reduces capital deterministically", () => {
  assert.equal(preserveCapital(base()).decision, "PRESERVE");
  assert.equal(preserveCapital(base({ drawdown: 0.25 })).decision, "REDUCE");
  assert.equal(preserveCapital(base({ drawdown: 0.4 })).decision, "HALT");
});

test("uncertain recovery fails closed", () => {
  const result = preserveCapital(base({ recoveryUncertain: true }));
  assert.equal(result.decision, "HALT");
  assert.equal(result.permittedCapital, 0);
  assert.ok(result.reasons.includes("RECOVERY_UNCERTAIN"));
});
