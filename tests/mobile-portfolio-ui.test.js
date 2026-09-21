const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildPortfolioViewModel } = require("../dist/apps/mobile/src/portfolioViewModel.js");

const response = (overrides = {}) => {
  const { account: accountOverrides, ...rest } = overrides;
  return {
  observedAt: "2026-08-03T00:00:00.000Z",
  mode: "PAPER",
  account: {
    available: true,
    cash: 500,
    equity: 1_000,
    unrealizedPnl: 100,
    markPrice: 500,
    position: { market: "KRW-BTC", quantity: 1, averagePrice: 400, realizedPnl: 25 },
    ...(accountOverrides ?? {})
  },
  openOrderCount: 2,
  ...rest
  };
};

test("Portfolio UI model reconciles equity and exposes position metrics", () => {
  const result = buildPortfolioViewModel(response());
  assert.equal(result.totalEquity, 1_000);
  assert.equal(result.assetValue, 500);
  assert.equal(result.totalPnl, 125);
  assert.equal(result.position.currentPrice, 500);
  assert.equal(result.returnRate, null, "return stays unavailable without a verified baseline");
});

test("Portfolio UI model snapshot is deterministic", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(buildPortfolioViewModel(response()))), {
    totalEquity: 1000,
    cash: 500,
    assetValue: 500,
    totalPnl: 125,
    realizedPnl: 25,
    unrealizedPnl: 100,
    returnRate: null,
    position: { market: "KRW-BTC", quantity: 1, averagePrice: 400, currentPrice: 500, unrealizedPnl: 100, realizedPnl: 25 },
    openOrderCount: 2
  });
});

test("Portfolio UI model fails closed for unavailable or inconsistent data", () => {
  assert.throws(() => buildPortfolioViewModel(response({ account: { available: false, reason: "MARKET_DATA_UNAVAILABLE" } })), /MARKET_DATA_UNAVAILABLE/);
  assert.throws(() => buildPortfolioViewModel(response({ account: { equity: 900 } })), /reconcile/);
});

test("Portfolio screen exposes truthful verified totals without unavailable return UI", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "portfolioView.tsx"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");
  assert.match(source, /PAPER DATA UNAVAILABLE/);
  assert.match(source, /UNKNOWN 값을 0으로 표시하지 않습니다/);
  assert.match(source, /NO EXPOSURE/);
  assert.match(source, /RefreshControl/);
  assert.match(source, /testID="portfolio-supervisor-summary"/);
  assert.match(source, /label: "PAPER EQUITY", value: money\(model\?\.totalEquity\)/);
  assert.match(source, /kicker="CAPITAL"/);
  assert.match(source, /label="REALIZED PNL" value=\{signedMoney\(position\.realizedPnl\)\}/);
  assert.match(source, /label="UNREALIZED PNL" value=\{signedMoney\(position\.unrealizedPnl\)\}/);
  assert.match(source, /testID="portfolio-upbit-read-only"/);
  assert.match(source, /REAL_READ_ONLY 잔고는 감독용 기준선이며 PAPER 성과와 절대 합산하지 않습니다\./);
  assert.match(source, /PAPER RESULT/);
  assert.doesNotMatch(source, /대표 포지션|대표 열린 포지션/);
  // This used to be a blanket ban on 수익률, from a time when the screen showed a return it could
  // not support. The hero now shows one, so assert the truthfulness instead of the absence: it is
  // derived from the same verified equity and PnL shown beside it, and renders — rather than 0%
  // when there is no cost basis to divide by.
  assert.match(source, /const costBasis = model != null \? model\.totalEquity - model\.totalPnl : null;/);
  assert.match(source, /const totalReturn = model != null && costBasis != null && costBasis > 0 \? model\.totalPnl \/ costBasis : null;/);
  assert.match(source, /\{totalReturn == null \? "—"/);
  // Exactly zero is neither a gain nor a loss. Verified on a rendered Pixel 6 frame, the hero showed
  // "+0.00%" in the success colour over a book that had never traded — a positive claim the numbers
  // do not carry. Zero now reads muted and unsigned.
  assert.match(source, /color: totalReturn == null \|\| totalReturn === 0 \? theme\.colors\.textMuted : totalReturn > 0 \?/);
  assert.match(source, /\$\{totalReturn > 0 \? "\+" : ""\}/);
  assert.match(source, /color: model == null \|\| model\.totalPnl === 0 \? theme\.colors\.textMuted : model\.totalPnl > 0 \?/);
  assert.doesNotMatch(source, /totalReturn >= 0 \? theme\.colors\.success/);
  assert.doesNotMatch(source, /testID="portfolio-summary"/);
  assert.doesNotMatch(source, /MetricTile/);
  assert.match(source, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
  assert.match(app, /activeTab === "Portfolio"/);
  assert.match(app, /<PortfolioView/);
});
