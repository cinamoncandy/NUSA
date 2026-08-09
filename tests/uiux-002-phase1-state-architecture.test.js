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

  assert.ok(errorIndex >= 0, "AI must expose an explicit error state");
  assert.ok(loadingIndex > errorIndex, "AI loading must be evaluated after error state");
  assert.ok(screenIndex > loadingIndex, "analysis cards must not render before terminal state checks");
  assert.match(ai, /testID="ai-loading"/);
  assert.match(ai, /testID="ai-error"/);
  assert.match(ai, /ZERO AUTHORITY/);
  assert.match(ai, /READ ONLY/);
});

test("Markets does not expose chart navigation without verified candles", () => {
  const markets = source("marketsView.tsx");
  assert.match(markets, /const chartAvailable = Array\.isArray\(rawCandles\) && rawCandles\.length > 0/);
  assert.match(markets, /\{chartAvailable \? <View/);
});

test("PAPER hides mutation controls when submit authority is absent", () => {
  const trading = source("tradingView.tsx");
  assert.match(trading, /const readOnly = onSubmit === undefined/);
  assert.match(trading, /동작하지 않는 주문 컨트롤은 표시하지 않습니다/);
  assert.match(trading, /ZERO MUTATION/);
});
