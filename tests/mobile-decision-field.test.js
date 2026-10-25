"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const m = require("../dist/apps/mobile/src/decisionFieldModel.js");

test("a day that fits the grid lights one dot per decision and says so", () => {
  const f = m.buildDecisionField({ decisionCount: 37, orderCount: 2 });
  assert.equal(f.unit, 1);
  assert.equal(f.litDots, 37);
  assert.equal(f.orderDots, 2);
  assert.match(f.caption, /오늘 판단 37건 · 점 1개 = 1건 · 밝은 점 = 주문 2건/);
  assert.equal(f.known, true);
});

test("a big day scales the dots and the card states the scale; lit dots never exceed the grid", () => {
  const f = m.buildDecisionField({ decisionCount: 1800, orderCount: 0 });
  assert.equal(f.unit, 8);
  assert.equal(f.litDots, 225);
  assert.ok(f.litDots * f.unit >= 1800 && (f.litDots - 1) * f.unit < 1800, "the lit dots cover the real count with less than one unit of rounding");
  assert.match(f.caption, /점 1개 = 8건 · 주문 0건/);
  const huge = m.buildDecisionField({ decisionCount: 1e9, orderCount: 3 });
  assert.equal(huge.litDots, m.FIELD_CAPACITY);
  assert.ok(huge.orderDots <= huge.litDots);
});

test("zero decisions light nothing, and unknown or invalid input draws an empty grid with no number", () => {
  assert.equal(m.buildDecisionField({ decisionCount: 0, orderCount: 0 }).litDots, 0);
  for (const bad of [null, undefined, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const f = m.buildDecisionField({ decisionCount: bad, orderCount: 4 });
    assert.equal(f.known, false);
    assert.equal(f.litDots, 0);
    assert.equal(f.orderDots, 0);
    assert.doesNotMatch(f.caption, /\d/);
  }
});

test("order dots are a subset of the lit dots and never exceed the real order count", () => {
  assert.equal(m.buildDecisionField({ decisionCount: 3, orderCount: 9 }).orderDots, 3);
  assert.equal(m.buildDecisionField({ decisionCount: 50, orderCount: null }).orderDots, 0);
  assert.doesNotMatch(m.buildDecisionField({ decisionCount: 50, orderCount: null }).caption, /주문/);
});

test("the sweep highlight is a wrapping window of columns and bad input yields nothing", () => {
  assert.deepEqual(m.sweepColumns(0, 24), [0, 23, 22]);
  assert.deepEqual(m.sweepColumns(0.5, 24), [12, 11, 10]);
  assert.deepEqual(m.sweepColumns(1.5, 24), m.sweepColumns(0.5, 24));
  assert.deepEqual(m.sweepColumns(-0.25, 24), m.sweepColumns(0.75, 24));
  assert.deepEqual(m.sweepColumns(Number.NaN, 24), [0, 23, 22]);
  assert.deepEqual(m.sweepColumns(0.3, 0), []);
  assert.deepEqual(m.sweepColumns(0.3, 24, 0), []);
  assert.equal(m.sweepColumns(0.99, 24).every((c) => c >= 0 && c < 24), true);
});

test("the field sweeps only while live, with motion allowed and data known; every Points draw is guarded", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "apps/mobile/src/decisionField.tsx"), "utf8");
  assert.match(src, /useSweep\(live && reducedMotion === false && model\.known\)/);
  assert.match(src, /if \(!active\) \{ setPhase\(0\); return undefined; \}/);
  assert.match(src, /return \(\) => clearInterval\(timer\)/);
  for (const line of src.split("\n").filter((l) => l.includes("<Points"))) assert.match(line, /nonEmpty\(/);
  const now = fs.readFileSync(path.join(__dirname, "..", "apps/mobile/src/instrumentNow.tsx"), "utf8");
  assert.match(now, /<DecisionField decisionCount=\{decisionCount\} orderCount=\{orderCount\} live=\{live\} reducedMotion=\{reduced\} \/>/);
});
