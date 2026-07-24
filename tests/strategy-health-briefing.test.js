const test = require("node:test");
const assert = require("node:assert/strict");
const { buildStrategyHealthBriefing } = require("../dist/apps/mobile/src/strategyHealthBriefing.js");

const audit = (overrides = {}) => ({
  periodStart: 0,
  periodEnd: 1_000,
  generatedAt: 1_100,
  totalTrades: 4,
  totalNetPnl: 12,
  totalExpectedEdgeValue: 20,
  totalCapturedEdgeValue: 12,
  portfolioCaptureRatio: 0.6,
  averageCalibrationError: 0.2,
  totalExecutionDrag: 2,
  strategies: [
    { strategyId: "funding-carry", tradeCount: 2, netPnl: 10, averageCaptureRatio: 0.8, averageCalibrationError: 0.1, executionCostRatio: 0.1, health: "HEALTHY", reasons: [] },
    { strategyId: "momentum", tradeCount: 2, netPnl: 2, averageCaptureRatio: 0.2, averageCalibrationError: 0.4, executionCostRatio: 0.5, health: "THROTTLE_RECOMMENDED", reasons: ["LOW_EDGE_CAPTURE"] }
  ],
  warnings: ["momentum:THROTTLE_RECOMMENDED"],
  ...overrides
});

test("builds deterministic read-only strategy health briefing", () => {
  const first = buildStrategyHealthBriefing({ audit: audit(), maximumAgeMs: 1_000 }, 1_200);
  const second = buildStrategyHealthBriefing({ audit: audit(), maximumAgeMs: 1_000 }, 1_200);
  assert.deepEqual(first, second);
  assert.equal(first.status, "CAUTION");
  assert.equal(first.portfolioCapturePercent, 60);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.cards));
});

test("paper-only recommendation blocks the briefing", () => {
  const result = buildStrategyHealthBriefing({
    audit: audit({ strategies: [{ strategyId: "latency", tradeCount: 4, netPnl: -10, averageCaptureRatio: -0.2, averageCalibrationError: 0.7, executionCostRatio: 1.1, health: "PAPER_ONLY_RECOMMENDED", reasons: ["NET_PNL_BELOW_THRESHOLD", "LOW_EDGE_CAPTURE"] }] }),
    maximumAgeMs: 1_000
  }, 1_200);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.cards[0].severity, "BLOCKED");
});

test("healthy strategies produce a healthy briefing", () => {
  const result = buildStrategyHealthBriefing({ audit: audit({ strategies: [audit().strategies[0]], warnings: [] }), maximumAgeMs: 1_000 }, 1_200);
  assert.equal(result.status, "HEALTHY");
});

test("stale, future and duplicate strategy summaries fail closed", () => {
  assert.throws(() => buildStrategyHealthBriefing({ audit: audit(), maximumAgeMs: 10 }, 1_200), /stale/);
  assert.throws(() => buildStrategyHealthBriefing({ audit: audit({ generatedAt: 1_300 }), maximumAgeMs: 1_000 }, 1_200), /future/);
  assert.throws(() => buildStrategyHealthBriefing({ audit: audit({ strategies: [audit().strategies[0], audit().strategies[0]] }), maximumAgeMs: 1_000 }, 1_200), /duplicate/);
});
