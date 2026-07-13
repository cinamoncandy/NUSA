const test = require("node:test");
const assert = require("node:assert/strict");
const { allocateCapital } = require("../dist/apps/cloud/src/capitalAllocationEngine.js");

const permission = Object.freeze({
  decisionId: "decision-001",
  strategyId: "alpha-001",
  market: "KRW-BTC",
  decision: "PERMIT",
  passedGates: Object.freeze([]),
  failedGates: Object.freeze([]),
  gates: Object.freeze([]),
  rejectionReasons: Object.freeze([]),
  evidenceReferences: Object.freeze(["probability:001"]),
  policyVersion: "trade-permission-v1",
  probabilityModelVersion: "probability-v1",
  generatedAt: "2026-07-13T09:00:00.000Z",
  expiresAt: "2026-07-13T09:01:00.000Z"
});

const policy = Object.freeze({
  policyVersion: "capital-v1",
  fractionalKelly: 0.25,
  maximumPortfolioWeight: 0.8,
  maximumStrategyWeight: 0.2,
  minimumCashReserveWeight: 0.2,
  maximumCorrelation: 0.7,
  maximumRiskBudgetUsage: 0.8,
  maximumDrawdown: 0.2,
  dailyLossLimit: 0.02,
  monthlyLossLimit: 0.06,
  minimumAllocationUsd: 100
});

const input = Object.freeze({
  allocationId: "allocation-001",
  generatedAt: "2026-07-13T09:00:10.000Z",
  permission,
  strategyStatus: "CHAMPION",
  totalEquityUsd: 100000,
  availableCashUsd: 60000,
  currentPortfolioGrossWeight: 0.3,
  currentStrategyWeight: 0,
  calibratedProbability: 0.93,
  expectedReward: 0.02,
  expectedLoss: 0.01,
  annualizedVolatility: 0.2,
  liquidityScore: 0.9,
  capacityUsd: 30000,
  maximumPeerCorrelation: 0.4,
  riskBudgetUsage: 0.3,
  drawdown: 0.03,
  dailyReturn: 0.001,
  monthlyReturn: 0.01,
  killSwitchActive: false
});

test("allocates deterministic capital only after permission", () => {
  const result = allocateCapital(input, policy);
  assert.equal(result.decision, "ALLOCATE");
  assert.ok(result.targetCapitalUsd > 0);
  assert.ok(result.targetWeight <= policy.maximumStrategyWeight);
  assert.equal(result.cashReserveUsd, 20000);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.reasons));
});

test("rejects paper strategies", () => {
  const result = allocateCapital({ ...input, strategyStatus: "PAPER" }, policy);
  assert.equal(result.decision, "REJECT");
  assert.equal(result.targetCapitalUsd, 0);
  assert.ok(result.reasons.includes("STRATEGY_NOT_CAPITAL_ELIGIBLE"));
});

test("rejects when permission is rejected", () => {
  const result = allocateCapital({
    ...input,
    permission: { ...permission, decision: "REJECT" }
  }, policy);
  assert.equal(result.decision, "REJECT");
  assert.ok(result.reasons.includes("TRADE_PERMISSION_REJECTED"));
});

test("kill switch and loss limits force zero allocation", () => {
  const result = allocateCapital({
    ...input,
    killSwitchActive: true,
    dailyReturn: -0.03,
    monthlyReturn: -0.07
  }, policy);
  assert.equal(result.decision, "REJECT");
  assert.equal(result.targetWeight, 0);
  assert.ok(result.reasons.includes("KILL_SWITCH_ACTIVE"));
  assert.ok(result.reasons.includes("DAILY_LOSS_LIMIT_REACHED"));
  assert.ok(result.reasons.includes("MONTHLY_LOSS_LIMIT_REACHED"));
});

test("drawdown governor reduces capital", () => {
  const normal = allocateCapital(input, policy);
  const stressed = allocateCapital({ ...input, drawdown: 0.16 }, policy);
  assert.ok(stressed.drawdownMultiplier < normal.drawdownMultiplier);
  assert.ok(stressed.targetCapitalUsd < normal.targetCapitalUsd);
  assert.ok(stressed.reasons.includes("DRAWDOWN_GOVERNOR_APPLIED"));
});

test("capacity and correlation constrain target", () => {
  const result = allocateCapital({
    ...input,
    capacityUsd: 5000,
    maximumPeerCorrelation: 0.9
  }, policy);
  assert.ok(result.targetCapitalUsd <= 5000);
  assert.ok(result.correlationMultiplier < 1);
  assert.ok(result.reasons.includes("CORRELATION_LIMIT_APPLIED"));
});

test("rejects expired permission", () => {
  assert.throws(() => allocateCapital({
    ...input,
    generatedAt: "2026-07-13T09:02:00.000Z"
  }, policy), /expired/);
});
