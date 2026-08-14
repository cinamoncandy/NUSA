const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Markets hides chart interaction until real candle data exists", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "marketsView.tsx"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");

  assert.match(source, /const chartAvailable = Array\.isArray\(rawCandles\) && rawCandles\.length > 0/);
  assert.match(source, /!tabletWorkspace && chartAvailable \? <View/);
  assert.match(source, /segment\("CHART",\s*"차트",\s*"markets-chart-tab"\)/);
  assert.match(source, /visiblePanel === "WATCHLIST"/);
  assert.match(app, /rawCandles=\{null\}/);
});

test("Markets uses a simultaneous two-column workspace on tablets when candles are real", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "marketsView.tsx"), "utf8");

  assert.match(source, /const tabletWorkspace = width >= 768 && chartAvailable/);
  assert.match(source, /testID="markets-tablet-workspace"/);
  assert.match(source, /testID="markets-tablet-watchlist"/);
  assert.match(source, /testID="markets-tablet-chart"/);
  assert.match(source, /tabletWorkspace: \{ flex: 1, flexDirection: "row"/);
  assert.match(source, /!tabletWorkspace \? \(visiblePanel === "WATCHLIST"/);
});
