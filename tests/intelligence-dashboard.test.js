const test = require("node:test");
const assert = require("node:assert/strict");
const { buildIntelligenceDashboard } = require("../dist/apps/mobile/src/intelligenceDashboard.js");

const baseInput = () => ({
  generatedAt: 1_700_000_000_000,
  confidence: 0.84,
  riskLevel: "MEDIUM",
  outlook: "강세 우세지만 레버리지는 제한합니다.",
  news: [
    {
      id: "macro-cpi",
      headline: "미국 CPI 예상치 하회",
      category: "MACRO",
      source: "official-release",
      publishedAt: 300,
      reliability: 1,
      impact: 90,
      sentiment: "POSITIVE",
      relatedAssets: ["BTC", "ETH"],
      summary: "인플레이션 압력이 완화됐습니다."
    },
    {
      id: "crypto-etf",
      headline: "BTC ETF 순유입 증가",
      category: "CRYPTO",
      source: "fund-flow",
      publishedAt: 200,
      reliability: 0.9,
      impact: 95,
      sentiment: "POSITIVE",
      relatedAssets: ["BTC"],
      summary: "기관 수요가 증가했습니다."
    },
    {
      id: "security-event",
      headline: "중형 거래소 보안 사고",
      category: "SECURITY",
      source: "exchange-notice",
      publishedAt: 100,
      reliability: 0.8,
      impact: 70,
      sentiment: "NEGATIVE",
      relatedAssets: ["ETH"],
      summary: "단기 위험 회피 가능성이 있습니다."
    }
  ],
  scenarios: [
    { direction: "BEARISH", probability: 0.15, plan: "헤지 비중을 높입니다." },
    { direction: "BULLISH", probability: 0.6, plan: "현물 비중을 점진적으로 높입니다." },
    { direction: "SIDEWAYS", probability: 0.25, plan: "현금 비중을 유지합니다." }
  ],
  signals: [
    { id: "funding", label: "Funding", score: 61, explanation: "과열은 아닙니다." },
    { id: "etf", label: "ETF 유입", score: 92, explanation: "순유입이 증가했습니다." },
    { id: "dollar", label: "달러", score: 74, explanation: "달러 강세가 완화됐습니다." }
  ]
});

test("builds deterministic ranked mobile intelligence dashboard", () => {
  const first = buildIntelligenceDashboard(baseInput());
  const second = buildIntelligenceDashboard(baseInput());
  assert.deepEqual(first, second);
  assert.equal(first.primaryScenario.direction, "BULLISH");
  assert.deepEqual(first.topNews.map((item) => item.id), ["macro-cpi", "crypto-etf", "security-event"]);
  assert.deepEqual(first.signals.map((item) => item.id), ["etf", "dollar", "funding"]);
  assert.equal(first.disclaimer, "SCENARIO_NOT_PREDICTION");
});

test("limits top news without changing priority ordering", () => {
  const dashboard = buildIntelligenceDashboard(baseInput(), 2);
  assert.deepEqual(dashboard.topNews.map((item) => item.id), ["macro-cpi", "crypto-etf"]);
});

test("normalizes related assets and freezes the result", () => {
  const input = baseInput();
  input.news[0] = { ...input.news[0], relatedAssets: ["ETH", "BTC"] };
  const dashboard = buildIntelligenceDashboard(input);
  assert.deepEqual(dashboard.topNews[0].relatedAssets, ["BTC", "ETH"]);
  assert.ok(Object.isFrozen(dashboard));
  assert.ok(Object.isFrozen(dashboard.topNews));
  assert.ok(Object.isFrozen(dashboard.scenarios));
});

test("rejects invalid scenario probability totals", () => {
  const input = baseInput();
  input.scenarios = [
    { direction: "BULLISH", probability: 0.7, plan: "A" },
    { direction: "SIDEWAYS", probability: 0.2, plan: "B" },
    { direction: "BEARISH", probability: 0.2, plan: "C" }
  ];
  assert.throws(() => buildIntelligenceDashboard(input), /sum to 1/);
});

test("rejects duplicate scenario directions", () => {
  const input = baseInput();
  input.scenarios = [
    { direction: "BULLISH", probability: 0.5, plan: "A" },
    { direction: "BULLISH", probability: 0.25, plan: "B" },
    { direction: "BEARISH", probability: 0.25, plan: "C" }
  ];
  assert.throws(() => buildIntelligenceDashboard(input), /exactly once/);
});

test("rejects duplicate news and signal ids", () => {
  const duplicateNews = baseInput();
  duplicateNews.news[1] = { ...duplicateNews.news[1], id: duplicateNews.news[0].id };
  assert.throws(() => buildIntelligenceDashboard(duplicateNews), /duplicate news id/);

  const duplicateSignals = baseInput();
  duplicateSignals.signals[1] = { ...duplicateSignals.signals[1], id: duplicateSignals.signals[0].id };
  assert.throws(() => buildIntelligenceDashboard(duplicateSignals), /duplicate signal id/);
});

test("rejects non-finite scores and invalid news timestamps", () => {
  const invalidScore = baseInput();
  invalidScore.signals[0] = { ...invalidScore.signals[0], score: Number.NaN };
  assert.throws(() => buildIntelligenceDashboard(invalidScore), /signal.score/);

  const invalidTimestamp = baseInput();
  invalidTimestamp.news[0] = { ...invalidTimestamp.news[0], publishedAt: -1 };
  assert.throws(() => buildIntelligenceDashboard(invalidTimestamp), /publishedAt/);
});

test("rejects duplicate related assets and invalid display limits", () => {
  const input = baseInput();
  input.news[0] = { ...input.news[0], relatedAssets: ["BTC", "BTC"] };
  assert.throws(() => buildIntelligenceDashboard(input), /relatedAssets/);
  assert.throws(() => buildIntelligenceDashboard(baseInput(), 0), /maximumNewsItems/);
});
