const test = require("node:test");
const assert = require("node:assert/strict");
const { createTheme } = require("../dist/apps/mobile/src/designSystem.js");
const { initialHoloState, tickHolo, holoColor, easeOutCubic, isHoloQuiet, HOLO_COLORS, HOLO_BIRTH_MS } = require("../dist/apps/mobile/src/holoModel.js");

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (hex) => { const [r, g, b] = rgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const dist = (a, b) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));
const colors = createTheme("dark").colors;

test("Cold-future text and controls stay readable on the dark ground", () => {
  assert.ok(contrast(colors.text, colors.background) >= 12, "primary text");
  assert.ok(contrast(colors.textMuted, colors.background) >= 7, "secondary text");
  assert.ok(contrast(colors.textMuted, colors.surface) >= 6, "secondary text on cards");
  assert.ok(contrast(colors.primary, colors.background) >= 10, "primary control against the ground");
  assert.ok(contrast(colors.onPrimary, colors.primary) >= 10, "label on a primary button");
  assert.ok(contrast(colors.focus, colors.background) >= 7, "focus ring");
});

test("decorative colours can never be mistaken for a status colour", () => {
  const decorative = { primary: colors.primary, focus: colors.focus, info: colors.info, text: colors.text, neonPurple: colors.neonPurple, neonBlue: colors.neonBlue };
  const status = { success: colors.success, warning: colors.warning, danger: colors.danger };
  for (const [dn, d] of Object.entries(decorative)) for (const [sn, s] of Object.entries(status)) assert.ok(dist(d, s) >= 90, `${dn} vs ${sn}`);
  assert.ok(dist(colors.success, colors.warning) >= 100);
  assert.ok(dist(colors.warning, colors.danger) >= 90);
  assert.ok(dist(colors.success, colors.danger) >= 150);
});

test("the sphere blooms from the core: eased, once, then quiet", () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.ok(easeOutCubic(0.2) > 0.4, "fast start");
  assert.ok(easeOutCubic(2) === 1 && easeOutCubic(-1) === 0);
  let s = initialHoloState();
  assert.equal(s.birth, 0);
  assert.equal(isHoloQuiet(s), false, "not quiet while it is still opening");
  for (let t = 0; t < HOLO_BIRTH_MS + 200; t += 42) s = tickHolo(s, "normal", 42, 1000 + t);
  assert.equal(s.birth, 1);
  assert.equal(isHoloQuiet(s), true);
});

test("a status tint fades in and out smoothly instead of snapping", () => {
  let s = { ...initialHoloState(), birth: 1 };
  const seen = [];
  for (let i = 0; i < 200; i += 1) { s = tickHolo(s, "halt", 42, 1000 + i * 42); seen.push(s.tintMix); }
  assert.ok(seen[0] > 0 && seen[0] < 0.2, "starts gently");
  assert.ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]), "monotonic");
  assert.equal(seen[seen.length - 1], 1);
  for (let i = 0; i < 240; i += 1) s = tickHolo(s, "normal", 42, 9000 + i * 42);
  assert.equal(s.tintMix, 0);
});

test("halt and hold keep their unmistakable colour at full tint, and normal never tints", () => {
  const mix = (tone, tintMix) => holoColor(0, 1, 0, tone, 0, HOLO_COLORS.cyan, tintMix);
  const normal = mix("normal", 1);
  const full = mix("halt", 1), none = mix("halt", 0);
  assert.deepEqual(none.map(Math.round), normal.map(Math.round), "no tint yet looks normal");
  assert.ok(full[0] > 220 && full[1] < 190, "halt reads red at full tint");
  const hold = mix("hold", 1);
  assert.ok(hold[0] > 220 && hold[1] > 160 && hold[2] < 170, "hold reads amber at full tint");
  assert.deepEqual(holoColor(0, 1, 0, "halt", 0, HOLO_COLORS.cyan).map(Math.round), full.map(Math.round), "default keeps the old fully tinted behaviour");
});

test("holo state advances by elapsed time, not by how often it is drawn", () => {
  const { initialHoloState, tickHolo, holoFrameBudgetMs, HOLO_QUIET_FRAME_MS, HOLO_ACTIVE_FRAME_MS } = require("../dist/apps/mobile/src/holoModel.js");
  assert.equal(holoFrameBudgetMs(true), HOLO_QUIET_FRAME_MS);
  assert.equal(holoFrameBudgetMs(false), HOLO_ACTIVE_FRAME_MS);
  assert.ok(HOLO_QUIET_FRAME_MS > HOLO_ACTIVE_FRAME_MS, "quiet frames are the cheaper ones");
  const run = (dt, tone) => { let s = { ...initialHoloState(), birth: 1 }; for (let t = 0; t < 4200; t += dt) s = tickHolo(s, tone, dt, 1000 + t); return s; };
  for (const [a, b] of [[42, 56], [42, 84]]) {
    assert.ok(Math.abs(run(a, "normal").spin - run(b, "normal").spin) / run(a, "normal").spin < 0.02, `spin matches at ${a} and ${b} ms`);
    assert.ok(Math.abs(run(a, "halt").tintMix - run(b, "halt").tintMix) < 0.03, `tint matches at ${a} and ${b} ms`);
  }
  assert.ok(run(56, "halt").spin < run(56, "normal").spin * 0.2, "halt nearly stops the spin");
});


test("the flow-field hero is deterministic: hairlines, wall rows and pulses stay within their bounds", () => {
  const M = require("../dist/apps/mobile/src/holoModel.js");
  const lines = M.flowLines(), rows = M.wallRows();
  assert.equal(lines.length, M.FLOW_LINE_COUNT);
  assert.equal(rows.length, M.FLOW_ROWS);
  assert.equal(M.flowLines(), lines, "cached and deterministic");
  assert.equal(M.wallRows(), rows, "cached and deterministic");
  assert.ok(M.flowArcX(0.5) > M.flowArcX(0) && M.flowArcX(0.5) > M.flowArcX(1) && Math.abs(M.flowArcX(0.5) - M.FLOW_ARC_X) < 1e-9, "the ruler bows right at the middle and bends away at the ends");
  assert.ok(M.flowArcX(0.5) < M.FLOW_WALL_END, "the ruler is left of the wall");
  for (const line of lines) {
    assert.ok(line.y >= 0 && line.y <= 1 && line.alpha > 0 && line.alpha < 0.6 && line.width <= 0.85 && line.length > 0 && line.speed > 0, "thin, faint hairlines");
    for (const t of [0, 1.7, 40, 5000]) {
      const seg = M.flowSegment(line, t), reach = M.flowArcX(line.y);
      assert.ok(seg.x0 >= 0 && seg.x1 <= reach + 1e-9 && seg.x0 <= seg.x1, "a hairline stays between the left edge and the ruler");
      assert.ok(seg.y0 >= 0 && seg.y0 <= 1 && seg.y1 >= 0 && seg.y1 <= 1 && seg.alpha >= 0 && seg.alpha <= line.alpha + 1e-9);
    }
  }
  assert.notDeepEqual(M.flowSegment(lines[0], 0), M.flowSegment(lines[0], 3), "the stream flows");
  for (const row of rows) {
    assert.ok(row.y > 0 && row.y < 1 && row.base > 0 && row.base <= 1);
    for (const grow of [0, 0.5, 1]) for (const t of [0, 2.2, 9]) {
      const bar = M.wallBar(row, t, grow);
      assert.ok(bar.x0 >= M.flowArcX(row.y) && bar.x1 >= bar.x0 && bar.x1 <= M.FLOW_WALL_END + 1e-9, "a bar stands between the ruler and the right edge");
    }
    assert.equal(M.wallBar(row, 1, 0).x1, M.wallBar(row, 1, 0).x0, "the wall grows out of the ruler during the entrance");
  }
  const ends = rows.map((row) => M.wallBar(row, 0, 1).x1);
  assert.ok(Math.max(...ends) - Math.min(...ends) > 0.15, "the wall's right edge is ragged, not a straight line");
  const wave = M.waveFor(4, 1000);
  assert.equal(M.pulseFor(wave, 999), null);
  assert.equal(M.pulseFor(wave, 1000 + M.HOLO_WAVE_MS + 1), null);
  let previous = -1, glow = 2;
  for (let ms = 0; ms <= M.HOLO_WAVE_MS; ms += 200) { const p = M.pulseFor(wave, 1000 + ms); assert.ok(p.reach >= previous && p.reach <= 1 + 1e-9 && p.glow <= glow + 1e-9 && p.glow >= 0, "a lit row reaches further and fades"); previous = p.reach; glow = p.glow; assert.equal(p.row, M.waveRow(wave)); }
  const seen = new Set(); for (let d = 1; d <= 200; d += 1) { const row = M.waveRow(M.waveFor(d, 0)); assert.ok(Number.isInteger(row) && row >= 0 && row < M.FLOW_ROWS); seen.add(row); }
  assert.ok(seen.size >= M.FLOW_ROWS / 3, "successive decisions light different rows");
  const band = M.flowBandRows(), centre = Math.round(M.FLOW_BAND_Y * M.FLOW_ROWS - 0.5);
  assert.ok(band.first >= 0 && band.last < M.FLOW_ROWS && band.first <= centre && centre <= band.last && band.last - band.first + 1 === M.FLOW_BAND_ROWS + (M.FLOW_BAND_ROWS % 2 === 0 ? 1 : 0), "the order band is centred on its height");
  let s = M.observeHolo(M.initialHoloState(), 10, 0, 0);
  assert.equal(s.markRow, null, "no marker row before a decision");
  s = M.observeHolo(s, 11, 0, 100);
  assert.equal(s.markRow, M.waveRow(M.waveFor(11, 100)), "the ruler marker follows the row the newest decision lit");
});

test("the hero is drawn as white ink on a stream, a ruler and a wall, and keeps its tone and still-figure contract", () => {
  const fs = require("node:fs");
  const { holoInk, holoColor, HOLO_COLORS } = require("../dist/apps/mobile/src/holoModel.js");
  const src = fs.readFileSync("apps/mobile/src/holoSphere.tsx", "utf8");
  for (const needle of [/flowLines\(\)/, /wallRows\(\)/, /flowSegment\(/, /wallBar\(row, tSec, grow\)/, /pulseFor\(wave, nowMs\)/, /flowClockSec\(s\)/, /flowBandRows\(\)/, /holoFillMarker\(S\)/]) assert.match(src, needle);
  assert.match(src, /holoInk\(tone, s\.tintMix\)/, "the figure follows the status tone");
  assert.match(src, /reducedMotion \? 0 : flowClockSec\(s\)/, "reduce-motion freezes the flow");
  assert.ok(!/burstStreaks|dustField|dustPosition|streakLength|BURST_|liquidRadius|crystalGeometry|scanBoost|ringPoint/.test(src), "old figures are gone");
  const white = holoInk("normal", 1), none = holoInk("halt", 0);
  assert.ok(white.every((v) => v > 220), "normal reads cool white");
  assert.deepEqual(none.map(Math.round), white.map(Math.round), "no tint yet looks normal");
  const hold = holoInk("hold", 1), halt = holoInk("halt", 1);
  assert.ok(hold[0] > 230 && hold[1] > 170 && hold[2] < 140, "hold reads amber at full tint");
  assert.ok(halt[0] > 230 && halt[1] < 160 && halt[2] > 110, "halt reads red at full tint");
  assert.ok(Math.abs(hold[1] - halt[1]) > 50, "hold and halt stay clearly different");
  assert.deepEqual(holoInk("normal", 1), holoInk("normal", 0), "normal never tints");
  assert.deepEqual(holoColor(-1, 0, 0, "halt", 0, HOLO_COLORS.cyan, 0).map(Math.round), holoColor(-1, 0, 0, "normal", 0, HOLO_COLORS.cyan, 1).map(Math.round), "the shared tint maths is unchanged");
});

test("the figure is dense and fine like the reference, with lime reserved for the order band", () => {
  const { HOLO_COLORS, FLOW_LINE_COUNT, FLOW_ROWS, flowLines, wallRows, holoInk } = require("../dist/apps/mobile/src/holoModel.js");
  const [lr, lg, lb] = HOLO_COLORS.lime; assert.ok(lr > 180 && lg > 230 && lb < 100, "lime stays a true lime");
  assert.ok(FLOW_LINE_COUNT >= 300 && FLOW_ROWS >= 100, "the stream and the wall are dense like the reference");
  assert.ok(flowLines().every((k) => k.width <= 0.85 && k.alpha <= 0.55), "hairlines are thin and faint");
  assert.ok(wallRows().filter((row) => row.bright).length > FLOW_ROWS * 0.5, "most wall rows are bright");
  const hold = holoInk("hold", 1), halt = holoInk("halt", 1);
  assert.ok(hold[0] > 230 && hold[1] > 170 && halt[0] > 230 && halt[1] < 160, "hold and halt still read amber and red on the white ink");
});

test("the renderer guards the blur, ticks only the full figure and keeps lime for the order band", () => {
  const src = require("node:fs").readFileSync("apps/mobile/src/holoSphere.tsx", "utf8");
  assert.match(src, /MakeBlur\(BlurStyle\.Normal, blur, true\)/);
  assert.match(src, /catch \{ \/\* no blur \*\/ \}/, "an unsupported blur must not break the figure");
  assert.match(src, /canvas\.drawPoints\(PointMode\.Polygon, arc\(-5\)/, "the ruler is two thin arcs");
  assert.match(src, /if \(detail === 1\) \{\s*for \(let i = 0; i < FLOW_TICKS/, "a small mark skips the ticks");
  assert.match(src, /const accent = tone === "normal" \? HOLO_COLORS\.lime : ink/);
  assert.ok(!/HOLO_COLORS\.lime/.test(src.replace(/const accent[^\n]*\n/, "")), "lime is used only for the accent");
});
