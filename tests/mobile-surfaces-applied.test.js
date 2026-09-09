"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const src = (name) => readFileSync(join(__dirname, "..", "apps", "mobile", "src", name), "utf8");
const HOME = src("homeView.tsx");
const SETTINGS = src("settingsView.tsx");
const TRADING = src("tradingView.tsx");

test("the equity hero carries its own age and is struck through when stale", () => {
  assert.match(HOME, /freshnessStage\(equityGeneratedAtMs, equityNowMs\)/);
  assert.match(HOME, /equityStale = equityStageValue === "STALE"/);
  assert.match(HOME, /balanceValueStale/);
  assert.match(HOME, /testID="account-hero-freshness"/);
  // The age must be read as part of the value, not as a separate unlabelled duration.
  assert.match(HOME, /accessibilityLabel=\{`\$\{krw\(account\?\.equity\)\}, \$\{equityAge\}/);
});

test("the connection flow renders the structured refusal, not only a flattened sentence", () => {
  assert.match(SETTINGS, /<RefusalRecord refusal=\{connectionRefusal\}/);
  assert.match(SETTINGS, /describeRefusal\(connectionError\.refusal, connectionError\.status\)/);
});

test("a stale refusal never outlives the attempt that produced it", () => {
  // Cleared when a new attempt starts and when the session is dropped, so the screen cannot
  // show a refusal from a previous token next to a fresh result.
  assert.equal(SETTINGS.match(/setConnectionRefusal\(null\)/g)?.length, 2);
});

test("production PAPER stays a supervision surface with no manual ticket", () => {
  // The refusal record deliberately did NOT go onto an order ticket: this route has none, and
  // adding one would contradict the documented safety contract rather than implement a design.
  assert.doesNotMatch(TRADING, /RefusalRecord/);
  assert.match(TRADING, /never exposes manual BUY\/SELL/);
});
