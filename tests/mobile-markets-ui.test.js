const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Markets hides chart interaction until real candle data exists across responsive layouts", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "marketsView.tsx"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");

  assert.match(source, /const chartAvailable = Array\.isArray\(rawCandles\) && rawCandles\.length > 0/);
  assert.match(source, /const wide = width >= 840/);
  assert.match(source, /const visiblePanel = chartAvailable \? panel : "WATCHLIST"/);
  assert.match(source, /\{chartAvailable && wide \? <ChartView/);
  assert.match(source, /\{chartAvailable && !wide \? <View[^>]*testID="markets-panels"/);
  assert.match(source, /<SegmentedControl/);
  assert.match(source, /testID="markets-panel-segmented-control"/);
  assert.match(source, /\{wide \|\| visiblePanel === "WATCHLIST" \? <WatchlistView[\s\S]*: <ChartView/);
  assert.match(source, /layoutWide: \{ flexDirection: "row"/);
  assert.match(source, /<ScreenHeader/);
  assert.match(source, /<MetricTile label="현재 가격"/);
  assert.match(app, /rawCandles=\{null\}/);
});
