"use strict";

// Canonical number-format contract tests (STEP-3 P2). These pin the exact
// outputs the six migrated screens previously produced independently, so the
// unification cannot silently change a single rendered digit.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  formatKRW,
  formatSignedMoney,
  formatSignedPercent,
} = require("../dist/apps/mobile/src/numberFormat.js");

test("KRW rounds with ko-KR grouping like every previous local copy", () => {
  assert.equal(formatKRW(1000000), "₩1,000,000");
  assert.equal(formatKRW(0), "₩0");
  assert.equal(formatKRW(1234.5), "₩1,235");
  assert.equal(formatKRW(-42.4), "₩-42");
});

test("signed money prefixes an explicit sign", () => {
  assert.equal(formatSignedMoney(2500), "+₩2,500");
  assert.equal(formatSignedMoney(-2500), "-₩2,500");
  assert.equal(formatSignedMoney(0), "+₩0");
});

test("signed percent keeps both missing-value conventions", () => {
  assert.equal(formatSignedPercent(0.024), "+2.40%");
  assert.equal(formatSignedPercent(-0.01), "-1.00%");
  assert.equal(formatSignedPercent(0), "0.00%");
  assert.equal(formatSignedPercent(null), "—");
  assert.equal(formatSignedPercent(null, "-"), "-");
});

test("no screen keeps a private KRW/percent copy after unification", () => {
  // homeDecisionSurface.ts is the documented exception: it is evaluated by
  // an isolated transpile harness (see mobile-home-decision-surface.test.js),
  // so it cannot import the shared module. Its copy is pinned identical.
  for (const file of [
    "apps/mobile/src/homeView.tsx",
    "apps/mobile/src/watchlistView.tsx",
    "apps/mobile/src/portfolioView.tsx",
    "apps/mobile/src/orderHistoryView.tsx",
    "apps/mobile/src/settingsView.tsx",
  ]) {
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    assert.doesNotMatch(source, /function (krw|money|signedMoney|formatPrice|formatChange)\(/);
    assert.doesNotMatch(source, /const money = /);
  }
  for (const file of [
    "apps/mobile/src/homeView.tsx",
    "apps/mobile/src/watchlistView.tsx",
    "apps/mobile/src/portfolioView.tsx",
    "apps/mobile/src/orderHistoryView.tsx",
    "apps/mobile/src/settingsView.tsx",
  ]) {
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    assert.match(source, /from "\.\/numberFormat"/);
  }
});
