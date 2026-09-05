const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const tradingViewSource = fs.readFileSync(
  path.resolve(__dirname, "../apps/mobile/src/tradingView.tsx"),
  "utf8",
);

test("TRADE public quotation stays independent from PAPER execution transport", () => {
  const effectStart = tradingViewSource.indexOf("const refreshTradePublicMarket = async");
  const effectEnd = tradingViewSource.indexOf("const chartModel = buildChartViewModel");
  assert.ok(effectStart > 0, "public quotation refresh effect must exist");
  assert.ok(effectEnd > effectStart, "public quotation refresh effect must complete before chart projection");

  const marketEffect = tradingViewSource.slice(effectStart, effectEnd);
  assert.match(marketEffect, /loadUpbitPublicMarkets\(\)/);
  assert.match(marketEffect, /loadUpbitPublicCandles\(/);
  assert.doesNotMatch(marketEffect, /usingLocalPaper/);
});

test("PAPER public chart is conditional on verified Cloud PAPER while the local execution workspace remains available", () => {
  assert.match(tradingViewSource, /const cloudPaperConnected = Boolean\(/);
  assert.match(tradingViewSource, /\{cloudPaperConnected \? <CloudPaperPublicChart \/> : null\}/);
  assert.match(tradingViewSource, /<LegacyTradingView \{\.\.\.props\} \/>/);
  assert.match(tradingViewSource, /testID="paper-authority-rail"/);
  assert.match(tradingViewSource, /SIMULATED EXECUTION · LIVE NONE · AI ZERO AUTHORITY/);
  assert.match(tradingViewSource, /CLOUD PAPER NOT CONNECTED/);
  assert.match(tradingViewSource, /testID="paper-upbit-market-panel"/);
  assert.match(tradingViewSource, /testID="paper-upbit-chart"/);
  assert.match(tradingViewSource, /공개 시장 관찰은 PAPER 전략 신호가 아니며 실제 주문 권한을 갖지 않습니다/);
});
