"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildHourDial, hourDialRowAt } = require("../dist/apps/mobile/src/hourDialModel.js");

const row = (hour, d, o) => ({ hour, startAt: hour * 3_600_000, values: [], orders: [], decisionCount: d, orderCount: o });

test("the hour ring places each hour on a clock face and lights it by real decisions only (UI v8)", () => {
  const model = { rows: [row(9, 2, 0), row(10, 8, 1), row(11, null, null)], progress: 0, thisHour: 2, stop: { row: 1, at: 0 }, hasTrace: true };
  const nodes = buildHourDial(model, 200, null);
  assert.equal(nodes.length, 3);
  assert.equal(nodes[1].level, 1);
  assert.equal(nodes[0].level, 0.25);
  assert.equal(nodes[2].level, null, "no usable count is an empty socket, never zero");
  assert.equal(nodes[1].order, true);
  assert.deepEqual(nodes.map((n) => n.limit), [false, true, true]);
  assert.equal(nodes[2].current, true);
  const top = buildHourDial({ ...model, rows: [row(0, 1, 0)] }, 200, null)[0];
  assert.ok(Math.abs(top.x - 100) < 1e-9 && top.y < 100, "00 sits at the top");
  assert.equal(hourDialRowAt(nodes, 200, nodes[1].x, nodes[1].y), 1);
  assert.equal(hourDialRowAt(nodes, 200, 100, 100), null, "the centre picks nothing");
});
