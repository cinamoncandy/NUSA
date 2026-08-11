const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "apps/mobile/App.tsx"), "utf8");
const tradingViewSource = fs.readFileSync(path.join(root, "apps/mobile/src/tradingView.tsx"), "utf8");
const orderEngineSource = fs.readFileSync(path.join(root, "apps/mobile/src/orderEngine.ts"), "utf8");
const tradingServiceSource = fs.readFileSync(path.join(root, "apps/mobile/src/tradingService.ts"), "utf8");

test("mobile product shell has no local execution-engine dependency", () => {
  assert.doesNotMatch(appSource, /from\s+["']\.\/src\/orderEngine["']/);
  assert.doesNotMatch(appSource, /from\s+["']\.\/src\/tradingService["']/);
  assert.doesNotMatch(appSource, /new\s+OrderEngine\s*\(/);
  assert.doesNotMatch(appSource, /new\s+MockExecutionEngine\s*\(/);
});

test("mobile PAPER screen is wired read-only in the production shell", () => {
  assert.match(appSource, /<TradingView\b/);
  assert.doesNotMatch(appSource, /<TradingView[^>]*\bonSubmit=/s);
  assert.match(appSource, /실행 권한 없음/);
  assert.match(appSource, /READ ONLY/);
});

test("trading view only exposes mutation controls when a governed callback is injected", () => {
  assert.match(tradingViewSource, /readonly onSubmit\?: \(draft: TradingDraft\) => void/);
  assert.match(tradingViewSource, /const readOnly = onSubmit === undefined/);
  assert.match(tradingViewSource, /ZERO MUTATION/);
});

test("legacy mobile execution helpers remain broker-disconnected simulation code", () => {
  assert.match(orderEngineSource, /class MockExecutionEngine/);
  assert.doesNotMatch(orderEngineSource, /fetch\s*\(/);
  assert.doesNotMatch(orderEngineSource, /https?:\/\//);
  assert.doesNotMatch(orderEngineSource, /broker/i);
  assert.match(tradingServiceSource, /class MockTradingService/);
  assert.match(tradingServiceSource, /\/paper\/trading\/orders/);
  assert.doesNotMatch(tradingServiceSource, /\/live\//i);
});
