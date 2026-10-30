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
  assert.equal(m.swellDepth(p, m.ISLAND_PULSE_MS), 0, "and ends at the back");
  assert.equal(m.swellDepth(p, m.ISLAND_PULSE_MS + 1), null);
  assert.equal(m.swellDepth(p, m.ISLAND_PULSE_MS / 2), 0.5, "eased: the middle of the glide is the middle row");
  assert.ok(m.swellDepth(p, m.ISLAND_PULSE_MS * 0.1) > 0.97, "and it leaves the front slowly");
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
  assert.match(core, /const badgeText = still != null \? still\.badge : validCount \? `오늘 판단 \$\{decisionCount\.toLocaleString\("en-US"\)\}` : null;/);
  assert.match(core, /scene\.summit != null && badgeText != null \? <View style=\{\[styles\.badge/);
  assert.match(core, /const validCount = decisionCount != null && Number\.isSafeInteger\(decisionCount\);/);
  assert.match(read("waveCore.tsx"), /UNUSED since 2026-10-28 \(the Now tab draws IslandCore\)/);
});

test("실거래 island rises only with real passed gates and stays grey; no counts, no badge", () => {
  assert.deepEqual(m.liveIsland(null, 12), { lift: 0, grey: true, badge: null });
  assert.deepEqual(m.liveIsland(13, 12), { lift: 0, grey: true, badge: null });
  assert.deepEqual(m.liveIsland(1.5, 12), { lift: 0, grey: true, badge: null });
  const low = m.liveIsland(2, 12), high = m.liveIsland(10, 12);
  assert.ok(high.lift > low.lift && low.grey && high.grey);
  assert.equal(high.badge, "관문 10 / 12 통과");
});

test("선물 island is low and grey before start, coloured once running, and uses only the server headline", () => {
  const before = m.futuresIsland(false, ["선물 모의는", "시작 전이에요"]);
  const running = m.futuresIsland(true, ["선물 모의로", "배우는 중이에요"]);
  assert.ok(before.grey && !running.grey && running.lift > before.lift);
  assert.equal(before.badge, "선물 모의는 시작 전이에요");
});

test("실거래 and 선물 screens draw a still island from those real values", () => {
  assert.match(read("liveReadinessMonitorView.tsx"), /still=\{liveIsland\(gates\?\.passed \?\? null, gates\?\.total \?\? null\)\} testID="live-island"/);
  assert.match(read("futuresView.tsx"), /still=\{futuresIsland\(model\.started, model\.headline\)\} testID="futures-island"/);
  const core = read("islandCore.tsx");
  // A still island animates only when it breathes, and then only as the OS reduce-motion setting allows.
  assert.match(core, /const motion = still == null \|\| breathe \? reducedMotion : true;/);
  assert.match(core, /const breathe = still\?\.breathe === true;/);
  assert.match(read("liveReadinessMonitorView.tsx"), /const reducedMotion = useReducedMotion\(\);/);
  assert.match(read("futuresView.tsx"), /reducedMotion=\{reduced\} still=\{futuresIsland/);
  assert.doesNotMatch(core, /reducedMotion !== false/);
});

test("a breathing still island keeps its real height, colour and badge and drifts slower than the live island", () => {
  assert.equal(m.liveIsland(6, 12).breathe, true);
  assert.equal(m.liveIsland(6, 12).grey, true, "LIVE stays grey while locked");
  assert.equal(m.liveIsland(null, 12).breathe, undefined, "no real gate counts: flat and still");
  assert.equal(m.futuresIsland(false, ["a", "b"]).breathe, true);
  assert.ok(m.ISLAND_STILL_DRIFT > 0 && m.ISLAND_STILL_DRIFT < 0.4);
});

test("it draws every display frame on a fast device and holds a steady 30 fps on a slow one", () => {
  assert.equal(m.islandMinFrameGapMs(16.7), 0);
  assert.equal(m.islandMinFrameGapMs(25), 0);
  assert.equal(m.islandMinFrameGapMs(33), 33);
  assert.equal(m.islandMinFrameGapMs(100), 33);
});

test("the band of light has a softer wake behind it, front rows drift faster, and the island breathes", () => {
  assert.ok(m.rowGlow(0.5, 0.5) > 0.99, "the band itself is at full light");
  assert.ok(m.rowGlow(0.6, 0.5) > m.rowLight(0.6, 0.5), "the wake (toward the front) is lit beyond the band's own falloff");
  assert.ok(m.rowGlow(0.35, 0.5) < 0.1, "nothing is lit ahead of the band");
  assert.equal(m.rowGlow(0.5, null), 0);
  assert.ok(m.rowGlow(0, 0.5) <= 1 && m.rowGlow(1, 0.5) <= 1);
  assert.ok(m.rowPhase(10, 1) > m.rowPhase(10, 0), "front rows move faster than back rows");
  assert.equal(m.rowPhase(0, 0.7), 0, "a settled island with no drift stays put");
  assert.ok(m.islandBreath(0) === 1 && Math.abs(m.islandBreath(2.6) - 1) <= 0.03 + 1e-9);
});
