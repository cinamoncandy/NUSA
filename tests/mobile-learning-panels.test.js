"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const m = require("../dist/apps/mobile/src/learningPanelsModel.js");

test("the study timeline is sorted, marks the next verdict and counts days", () => {
  const rows = m.buildStudyTimeline(Date.parse("2026-10-22T12:00:00Z"));
  assert.deepEqual(rows.map((r) => r.id), ["호가", "S2~S4", "S5"]);
  assert.deepEqual(rows.map((r) => r.next), [true, false, false]);
  assert.equal(rows[0].dateLabel, "10-29");
  assert.match(rows[0].status, /결과 대기 · 7일 남음/);
  assert.match(rows[1].status, /설계 고정됨/);
});

test("a verdict time in the past asks for the result instead of claiming progress", () => {
  const rows = m.buildStudyTimeline(Date.parse("2026-11-01T00:00:00Z"));
  assert.match(rows[0].status, /판정 시점이 지났어요/);
  assert.equal(rows[0].tone, "ATTENTION");
  assert.equal(rows[1].next, true);
});

test("the cost wall is 20 bp and marks only the bars above it; without real input it is labelled as an example", () => {
  const w = m.buildCostWall();
  assert.equal(w.wallBp, 20);
  assert.equal(w.example, true);
  assert.deepEqual(w.bars.map((b) => b.over), [false, false, false, false, true]);
  assert.ok(w.bars.every((b) => b.ratio > 0 && b.ratio <= 1));
  const real = m.buildCostWall([{ label: "X", bp: 5 }, { label: "Y", bp: 40 }]);
  assert.equal(real.example, false);
  assert.deepEqual(real.bars.map((b) => b.over), [false, true]);
  assert.equal(m.buildCostWall([{ label: "X", bp: NaN }]).example, true);
});

test("decision bars use real hourly counts when valid, the latest four hours are recent, bad input falls back to the labelled example", () => {
  const real = m.buildDecisionBars([10, 20, 40, 0, 5, 30]);
  assert.equal(real.example, false);
  assert.equal(real.total, 105);
  assert.deepEqual(real.bars.map((b) => b.recent), [false, false, true, true, true, true]);
  assert.equal(real.bars[2].ratio, 1);
  assert.ok(real.bars[3].ratio >= 0.04);
  for (const bad of [null, undefined, [1], [1, -2], [1, NaN]]) assert.equal(m.buildDecisionBars(bad).example, true);
  assert.equal(m.buildDecisionBars().bars.length, 24);
});
