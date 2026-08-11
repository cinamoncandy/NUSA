const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Markets hides chart interaction until real candle data exists", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "marketsView.tsx"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");

  assert.match(source, /const chartAvailable = Array\.isArray\(rawCandles\) && rawCandles\.length > 0/);
  assert.match(source, /\{chartAvailable \? <View/);
  assert.match(source, /segment\("CHART",\s*"차트",\s*"markets-chart-tab"\)/);
  assert.match(source, /visiblePanel === "WATCHLIST"/);
  assert.match(app, /rawCandles=\{null\}/);
});
