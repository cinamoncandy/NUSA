const test = require("node:test");
const assert = require("node:assert/strict");
const { buildIntelligenceDashboard } = require("../dist/apps/mobile/src/intelligenceDashboard.js");
const { buildHomeDashboard } = require("../dist/apps/mobile/src/homeDashboard.js");

const intelligence = () => buildIntelligenceDashboard({
  generatedAt: 1_000,
  confidence: 0.8,
  riskLevel: "LOW",
  outlook: "신중한 강세",
  news: [{ id: "n1", headline: "ETF 순유입", category: "CRYPTO", source: "official", publishedAt: 900, reliability: 1, impact: 80, sentiment: "POSITIVE", relatedAssets: ["BTC"], summary: "순유입 증가" }],
  scenarios: [
    { direction: "BULLISH", probability: 0.6, plan: "현물 비중 유지" },
    { direction: "SIDEWAYS", probability: 0.3, plan: "현금 유지" },
    { direction: "BEARISH", probability: 0.1, plan: "노출 축소" }
  ],
  signals: [{ id: "s1", label: "ETF", score: 80, explanation: "유입 증가" }]
});

const input = (overrides = {}) => ({
  generatedAt: 1_100,
  currency: "KRW",
  totalAssets: 100_000,
  dailyPnl: 1_000,
  dailyReturn: 0.01,
  mode: "PAPER",
  aiHealth: "HEALTHY",
  riskLevel: "LOW",
  allocations: [
    { bucket: "SPOT", amount: 40_000 },
    { bucket: "FUTURES", amount: 20_000 },
    { bucket: "CASH", amount: 15_000 },
    { bucket: "WITHDRAWAL", amount: 10_000 },
    { bucket: "RESERVE", amount: 10_000 },
    { bucket: "PENDING", amount: 5_000 }
  ],
  intelligence: intelligence(),
  ...overrides
});

test("builds reconciled mobile home dashboard", () => {
  const result = buildHomeDashboard(input());
  assert.equal(result.deployableCapital, 75_000);
  assert.equal(result.protectedCapital, 20_000);
  assert.equal(result.pendingCapital, 5_000);
  assert.equal(result.canTrade, true);
  assert.deepEqual(result.allocations.map((item) => item.bucket), ["SPOT", "FUTURES", "CASH", "WITHDRAWAL", "RESERVE", "PENDING"]);
});

test("withdrawal and reserve capital never enter deployable capital", () => {
  const result = buildHomeDashboard(input({
    allocations: [
      { bucket: "WITHDRAWAL", amount: 60_000 },
      { bucket: "RESERVE", amount: 20_000 },
      { bucket: "CASH", amount: 20_000 }
    ]
  }));
  assert.equal(result.deployableCapital, 20_000);
  assert.equal(result.protectedCapital, 80_000);
});

test("fails closed when allocations do not reconcile", () => {
  assert.throws(() => buildHomeDashboard(input({ allocations: [{ bucket: "CASH", amount: 99_999 }] })), /reconcile/);
});

test("fails closed on duplicate capital buckets", () => {
  assert.throws(() => buildHomeDashboard(input({ allocations: [
    { bucket: "CASH", amount: 50_000 },
    { bucket: "CASH", amount: 50_000 }
  ] })), /duplicate/);
});

test("only PAPER has trading authority in the home projection", () => {
  assert.equal(buildHomeDashboard(input({ mode: "PAPER" })).canTrade, true);
  assert.equal(buildHomeDashboard(input({ mode: "LIVE" })).canTrade, false);
  assert.equal(buildHomeDashboard(input({ mode: "LIVE", aiHealth: "DEGRADED" })).canTrade, false);
  assert.equal(buildHomeDashboard(input({ mode: "LIVE", riskLevel: "CRITICAL" })).canTrade, false);
  assert.equal(buildHomeDashboard(input({ mode: "STOPPED" })).canTrade, false);
  assert.equal(buildHomeDashboard(input({ mode: "FAULTED" })).canTrade, false);
});

test("rejects future intelligence and non-finite values", () => {
  assert.throws(() => buildHomeDashboard(input({ generatedAt: 999 })), /future/);
  assert.throws(() => buildHomeDashboard(input({ dailyPnl: Number.NaN })), /dailyPnl/);
  assert.throws(() => buildHomeDashboard(input({ totalAssets: -1 })), /totalAssets/);
});

test("same input produces the same immutable output", () => {
  const first = buildHomeDashboard(input());
  const second = buildHomeDashboard(input());
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.allocations), true);
});
