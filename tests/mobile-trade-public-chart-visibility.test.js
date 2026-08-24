const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const tradingViewSource = fs.readFileSync(
  path.resolve(__dirname, "../apps/mobile/src/tradingView.tsx"),
  "utf8",
);

test("TRADE public quotation stays independent from PAPER execution transport", () => {
  const effectStart = tradingViewSource.indexOf("const refreshLocalMarket = async");
  const effectEnd = tradingViewSource.indexOf("if (!usingLocalPaper && error)");
  assert.ok(effectStart > 0, "public quotation refresh effect must exist");
  assert.ok(effectEnd > effectStart, "public quotation refresh effect must remain before execution-state guards");

  const marketEffect = tradingViewSource.slice(effectStart, effectEnd);
  assert.match(marketEffect, /loadUpbitPublicMarkets\(\)/);
  assert.match(marketEffect, /loadUpbitPublicCandles\(/);
  assert.doesNotMatch(marketEffect, /if\s*\(\s*!usingLocalPaper\s*\)\s*return/);
});

test("TRADE public chart panel is not hidden by LOCAL/CLOUD PAPER mode", () => {
  const marker = 'testID="paper-upbit-market-panel"';
  const panelIndex = tradingViewSource.indexOf(marker);
  assert.ok(panelIndex > 0, "TRADE public chart panel marker must exist");

  const prefix = tradingViewSource.slice(Math.max(0, panelIndex - 180), panelIndex);
  assert.doesNotMatch(prefix, /usingLocalPaper\s*\?\s*<View/);
  assert.match(tradingViewSource, /testID="paper-upbit-chart"/);
});
