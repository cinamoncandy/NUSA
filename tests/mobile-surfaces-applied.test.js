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

test("a derived figure ages with the price it was computed from", () => {
  const PORTFOLIO = src("portfolioView.tsx");
  // Unrealized PNL is quantity x current price. Left in profit green off an expired quote it
  // states a gain nobody can act on, so a stale price drops it to neutral and says why.
  assert.match(PORTFOLIO, /priceStale = priceStage === "STALE"/);
  assert.match(PORTFOLIO, /note=\{priceStale \? "현재가가 만료되어 이 값은 신뢰할 수 없습니다"/);
  assert.match(PORTFOLIO, /tone=\{priceStale \? "neutral" : position\.unrealizedPnl >= 0/);
});

test("realized PNL is exempt, because it is booked rather than derived", () => {
  const PORTFOLIO = src("portfolioView.tsx");
  const realized = PORTFOLIO.slice(PORTFOLIO.indexOf('label="REALIZED PNL"'));
  const row = realized.slice(0, realized.indexOf("/>"));
  assert.doesNotMatch(row, /priceStale/, "a booked figure must not dim with a live quote");
});

test("LOCAL PAPER carries no server stamp rather than a borrowed one", () => {
  const PORTFOLIO = src("portfolioView.tsx");
  // No server clock exists on that path, and inventing an age would be worse than showing none.
  assert.match(PORTFOLIO, /generatedAtMs == null \? null : freshnessStage/);
  assert.match(PORTFOLIO, /generatedAtMs == null \? undefined : describeAge/);
});

test("production PAPER stays a supervision surface with no manual ticket", () => {
  // The refusal record deliberately did NOT go onto an order ticket: this route has none, and
  // adding one would contradict the documented safety contract rather than implement a design.
  assert.doesNotMatch(TRADING, /RefusalRecord/);
  assert.match(TRADING, /never exposes manual BUY\/SELL/);
});
