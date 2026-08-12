const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mobile = path.resolve(__dirname, "../apps/mobile");

function source(file) {
  return fs.readFileSync(path.join(mobile, "src", file), "utf8");
}

test("AI distinguishes error and loading before rendering analysis content", () => {
  const ai = source("aiView.tsx");
  const errorIndex = ai.indexOf('if (error) return <AiState');
  const loadingIndex = ai.indexOf('if (ai === null && research === null) return <AiState');
  const screenIndex = ai.indexOf('testID="ai-screen"');

  assert.ok(errorIndex >= 0);
  assert.ok(loadingIndex > errorIndex);
  assert.ok(screenIndex > loadingIndex);
  assert.match(ai, /testID="ai-loading"/);
  assert.match(ai, /testID="ai-error"/);
  assert.match(ai, /ZERO AUTHORITY/);
  assert.match(ai, /READ ONLY/);
});

test("Markets hides chart navigation without verified candles", () => {
  const markets = source("marketsView.tsx");
  assert.match(markets, /const chartAvailable = Array\.isArray\(rawCandles\) && rawCandles\.length > 0/);
  assert.match(markets, /const visiblePanel = chartAvailable \? panel : "WATCHLIST"/);
  assert.match(markets, /\{chartAvailable && !wide \? <View[^>]*testID="markets-panels"/);
  assert.match(markets, /chartAvailable && wide \? <ChartView/);
});

test("PAPER hides mutation controls until verified PAPER submit authority exists", () => {
  const trading = source("tradingView.tsx");
  assert.match(trading, /const builtInSubmitAvailable = Boolean\(configuredEndpoint && credentialSession\.isConfigured\(\) && isPaperConnectionVerified\(configuredEndpoint\)\)/);
  assert.match(trading, /const submitAvailable = onSubmit !== undefined \|\| builtInSubmitAvailable/);
  assert.match(trading, /!submitAvailable \? <NusaCard><Text[^>]*>PAPER 주문 연결 필요<\/Text>/);
  assert.match(trading, /StatusChip label="PAPER ONLY"/);
  assert.match(trading, /StatusChip label="LIVE 금지"/);
});
