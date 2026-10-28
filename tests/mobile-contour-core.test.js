"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const c = require("../dist/apps/mobile/src/contourCoreModel.js");
const w = require("../dist/apps/mobile/src/waveCoreModel.js");
const read = (f) => fs.readFileSync(`apps/mobile/src/${f}`, "utf8").replace(/\r\n/g, "\n");

test("contour lines never cross, at any angle, warp or phase", () => {
  for (const warp of [0, 0.5, 1]) for (let phase = 0; phase < 12; phase += 1.7) for (let i = 0; i < 360; i += 3) {
    const theta = (i * Math.PI) / 180;
    for (let k = 0; k < c.CONTOUR_COUNT - 1; k += 1) {
      assert.ok(c.contourScale(k + 1, theta, phase, warp, 0) > c.contourScale(k, theta, phase, warp, 0), `line ${k} crosses ${k + 1}`);
    }
  }
});

test("the outer line stays inside the box and a fill draws every line to its resting circle", () => {
  assert.ok(c.CONTOUR_RX < 0.5 && c.CONTOUR_RY * 2 < 0.8, "outer line clears the edges, the strip and the title");
  for (let k = 0; k < c.CONTOUR_COUNT; k += 1) assert.ok(Math.abs(c.contourScale(k, 1.3, 4, 1, 1) - (k + 1) / c.CONTOUR_COUNT) < 1e-12);
  assert.ok(c.contourScale(c.CONTOUR_COUNT - 1, 0, 0, 1, 0) <= 1 + c.CONTOUR_MAX_WARP);
});

test("a ring starts at the centre, ends outside the last line, and lights the line it is on", () => {
  const p = { born: 0, order: false };
  assert.equal(c.ringPosition(p, -1), null);
  assert.equal(c.ringPosition(p, w.WAVE_PULSE_MS + 1), null);
  assert.ok(c.ringPosition(p, 0) < 0.5);
  assert.ok(c.ringPosition(p, w.WAVE_PULSE_MS) > c.CONTOUR_COUNT - 1);
  assert.ok(c.ringLight(4, 4) > 0.99 && c.ringLight(4, 8) < 0.01 && c.ringLight(4, null) === 0);
});

test("resting lines without data are dimmer than live ones", () => {
  assert.ok(c.contourOpacity(5, 0, 1) < c.contourOpacity(5, 0, 0));
  assert.ok(c.contourOpacity(5, 1, 0) > c.contourOpacity(5, 0, 0));
  assert.ok(c.contourOpacity(8, 1, 0) <= 1);
});

test("the Now tab draws the contour lines, and the old wave file is kept but unused", () => {
  const now = read("instrumentNow.tsx");
  assert.match(now, /import \{ ContourCore \} from "\.\/contourCore";/);
  assert.doesNotMatch(now, /WaveCore/);
  assert.match(read("waveCore.tsx"), /UNUSED since 2026-10-28/);
  assert.match(read("contourCore.tsx"), /decisionCount.*orderCount.*fillCount/s);
});
