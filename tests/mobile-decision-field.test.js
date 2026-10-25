"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const m = require("../dist/apps/mobile/src/decisionFieldModel.js");

test("the band states the real counts and the real order share", () => {
  const f = m.buildDecisionBand({ decisionCount: 40, orderCount: 10 });
  assert.equal(f.orderShare, 0.25);
  assert.equal(f.known, true);
  assert.match(f.caption, /오늘 판단 40건 · 그중 주문 10건/);
});

test("the order share never exceeds 1 and is 0 with no decisions or unknown orders", () => {
  assert.equal(m.buildDecisionBand({ decisionCount: 3, orderCount: 9 }).orderShare, 1);
  assert.equal(m.buildDecisionBand({ decisionCount: 0, orderCount: 0 }).orderShare, 0);
  const noOrders = m.buildDecisionBand({ decisionCount: 50, orderCount: null });
  assert.equal(noOrders.orderShare, 0);
  assert.doesNotMatch(noOrders.caption, /주문/);
});

test("unknown or invalid decision counts draw an empty track with no number", () => {
  for (const bad of [null, undefined, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const f = m.buildDecisionBand({ decisionCount: bad, orderCount: 4 });
    assert.equal(f.known, false);
    assert.equal(f.orderShare, 0);
    assert.doesNotMatch(f.caption, /\d/);
  }
});

test("the band glides only while live, with motion allowed and data known; it draws no dots", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "apps/mobile/src/decisionField.tsx"), "utf8");
  assert.match(src, /useSweep\(live && reducedMotion === false && model\.known\)/);
  assert.match(src, /if \(!active\) \{ setPhase\(0\); return undefined; \}/);
  assert.match(src, /return \(\) => clearInterval\(timer\)/);
  assert.doesNotMatch(src, /<Points/);
  const now = fs.readFileSync(path.join(__dirname, "..", "apps/mobile/src/instrumentNow.tsx"), "utf8");
  assert.match(now, /<DecisionField decisionCount=\{decisionCount\} orderCount=\{orderCount\} live=\{live\} reducedMotion=\{reduced\} \/>/);
});
