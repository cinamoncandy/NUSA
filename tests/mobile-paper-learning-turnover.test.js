"use strict";

// Compact TURNOVER display tests. Turnover is an unbounded cumulative KRW
// value; full locale strings grow unreadable past millions while ratios and
// scores keep exact precision. Display only — never accounting.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { formatCompactKRW } = require("../dist/apps/mobile/src/paperLearningScreen.js");

test("compacts large KRW while keeping small values exact", () => {
  assert.equal(formatCompactKRW(0), "₩0");
  assert.equal(formatCompactKRW(999), "₩999");
  assert.equal(formatCompactKRW(1000), "₩1K");
  assert.equal(formatCompactKRW(12345), "₩12.3K");
  assert.equal(formatCompactKRW(1000000), "₩1M");
  assert.equal(formatCompactKRW(2500000), "₩2.5M");
  assert.equal(formatCompactKRW(3400000000), "₩3.4B");
  assert.equal(formatCompactKRW(-2500), "-₩2.5K");
  assert.equal(formatCompactKRW(999999.99), "₩1M");
});

test("unverifiable input renders as missing, never zero", () => {
  assert.equal(formatCompactKRW(null), "—");
  assert.equal(formatCompactKRW(undefined), "—");
  assert.equal(formatCompactKRW(Number.NaN), "—");
});

test("TURNOVER metric uses the compact formatter", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "paperLearningMonitorView.tsx"), "utf8");
  assert.match(source, /label="TURNOVER" value=\{formatCompactKRW\(state\.performance\.turnover\)\}/);
});
