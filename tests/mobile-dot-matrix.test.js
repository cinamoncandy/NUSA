"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const d = require("../dist/apps/mobile/src/dotMatrix.js");

test("a digit is seven rows tall and lays out on the pitch grid", () => {
  const zero = d.layoutDotMatrix("0", 4);
  assert.equal(zero.height, 28);
  assert.equal(zero.width, 20);
  assert.ok(zero.dots.length > 10 && zero.dots.every((p) => p.x > 0 && p.x < 20 && p.y > 0 && p.y < 28));
  assert.equal(new Set(zero.dots.map((p) => `${p.x},${p.y}`)).size, zero.dots.length, "no duplicate dots");
});

test("text widens by glyph width plus one blank column and the minus sign draws as a bar", () => {
  const one = d.layoutDotMatrix("0", 2).width;
  const two = d.layoutDotMatrix("00", 2).width;
  assert.equal(two, one * 2 + 2);
  const minus = d.layoutDotMatrix("−", 2);
  assert.equal(minus.dots.length, 5);
  assert.ok(minus.dots.every((p) => p.y === 3.5 * 2));
});

test("an unsupported character is a blank, never an error, and a bad pitch yields nothing", () => {
  assert.doesNotThrow(() => d.layoutDotMatrix("a?\u{1F600}", 3));
  assert.equal(d.layoutDotMatrix("a", 3).dots.length, 0);
  assert.deepEqual(d.layoutDotMatrix("0", 0), { width: 0, height: 0, dots: [] });
  assert.deepEqual(d.layoutDotMatrix("0", Number.NaN), { width: 0, height: 0, dots: [] });
});

test("the lit count is exact, evenly spread, deterministic and never exceeds the total", () => {
  const a = d.litIndices(192, 15);
  assert.equal(a.length, 15);
  assert.deepEqual(a, d.litIndices(192, 15));
  assert.equal(new Set(a).size, 15);
  assert.ok(a.every((i) => i >= 0 && i < 192));
  assert.equal(d.litIndices(192, 0).length, 0);
  assert.equal(d.litIndices(10, 25).length, 10);
  assert.equal(d.litIndices(0, 5).length, 0);
  assert.equal(d.litIndices(1.5, 2).length, 0);
  assert.equal(d.litIndices(192, 192).length, 192);
});

test("the dot field layout rounds rows up", () => {
  assert.deepEqual(d.dotFieldLayout(192, 16, 10), { columns: 16, rows: 12, width: 160, height: 120 });
  assert.equal(d.dotFieldLayout(17, 16, 10).rows, 2);
  assert.equal(d.dotFieldLayout(0, 16, 10).rows, 0);
});
