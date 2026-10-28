"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const m = require("../dist/apps/mobile/src/islandCoreModel.js");
const w = require("../dist/apps/mobile/src/waveCoreModel.js");
const read = (f) => fs.readFileSync(`apps/mobile/src/${f}`, "utf8").replace(/\r\n/g, "\n");

test("the island is sea at both edges and land in the middle", () => {
  for (const d of [0.2, 0.5, 0.9]) {
    assert.equal(m.islandHeight(0, d, 0, 1, []), 0);
    assert.ok(m.islandHeight(1, d, 0, 1, []) < 1e-9);
    assert.ok(m.islandHeight(0.46, d, 0, 1, []) > m.ISLAND_LAND_EPS * 4, `land at the centre, depth ${d}`);
  }
  assert.ok(m.landRuns([0, 0, 0.2, 0.3, 0.1, 0, 0], 0.05).length === 1);
});

test("without data (amp 0) the island lies flat, and a swell lights the row it passes", () => {
  for (let u = 0; u <= 1; u += 0.1) assert.equal(m.islandHeight(u, 0.5, 0, 0, []), 0);
  assert.ok(m.rowLight(0.5, 0.5) > 0.99 && m.rowLight(0.5, 0.95) < 0.01 && m.rowLight(0.5, null) === 0);
  const p = { born: 0, order: false };
  assert.equal(m.swellDepth(p, 0), 1, "a band starts at the front row");
  assert.equal(m.swellDepth(p, w.WAVE_PULSE_MS), 0, "and ends at the back");
  assert.equal(m.swellDepth(p, w.WAVE_PULSE_MS + 1), null);
});

test("the island stays above the shore and below the top edge at full energy", () => {
  for (let r = 0; r < m.ISLAND_ROWS; r += 1) {
    const d = r / (m.ISLAND_ROWS - 1);
    let peak = 0;
    for (let u = 0; u <= 1; u += 0.01) peak = Math.max(peak, m.islandHeight(u, d, 3, 1.15, [{ pos: d, k: 0.25 }]));
    const top = m.rowBase(d) - peak * m.rowLift(d);
    assert.ok(top > 0.02, `row ${r} rises past the top edge (${top})`);
    assert.ok(m.rowBase(d) <= m.ISLAND_SHORE + 1e-9);
  }
  assert.ok(m.ISLAND_SEA_END < 0.93, "the sea ends above the last-minute strip");
});

test("row colour runs violet at the back to cyan at the front, and fog fades the back", () => {
  assert.equal(m.rowColor(0), "#5834b4");
  assert.equal(m.rowColor(1), "#46d7ff");
  assert.ok(m.rowOpacity(0, 0, 0) < m.rowOpacity(1, 1, 0));
  assert.ok(m.rowOpacity(0.5, 4, 0) > m.rowOpacity(0.5, 3, 0), "every fifth row is stronger");
});

test("the Now tab draws the island; the badge shows only a real decision count", () => {
  const now = read("instrumentNow.tsx");
  assert.match(now, /import \{ IslandCore \} from "\.\/islandCore";/);
  assert.doesNotMatch(now, /WaveCore|ContourCore/);
  const core = read("islandCore.tsx");
  assert.match(core, /scene\.summit != null && validCount \? <View style=\{\[styles\.badge/);
  assert.match(core, /const validCount = decisionCount != null && Number\.isSafeInteger\(decisionCount\);/);
  assert.match(read("waveCore.tsx"), /UNUSED since 2026-10-28 \(the Now tab draws IslandCore\)/);
});
