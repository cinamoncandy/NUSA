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

test("TRADE public chart is explicitly rendered for verified Cloud PAPER while legacy LOCAL PAPER stays intact", () => {
  assert.match(tradingViewSource, /cloudPaperConnected/);
  assert.match(tradingViewSource, /if \(!cloudPaperConnected\) return <LegacyTradingView/);
  assert.match(tradingViewSource, /<CloudPaperPublicChart \/>/);
  assert.match(tradingViewSource, /testID="paper-upbit-market-panel"/);
  assert.match(tradingViewSource, /testID="paper-upbit-chart"/);
  assert.match(tradingViewSource, /Upbit 공개 시세 · 읽기 전용 · PAPER 실행 경로와 독립/);
});
