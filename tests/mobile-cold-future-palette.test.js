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

test("orbit rings, scan sweep and overshoot bloom are deterministic and bounded", () => {
  const { easeOutBack, scanBoost: scan, ringPoint, HOLO_RING_POINTS } = require("../dist/apps/mobile/src/holoModel.js");
  const { fieldMotion } = require("../dist/apps/mobile/src/designSystem.js");
  const HOLO_SCAN_MS = fieldMotion.holoScanMs, scanBoost = (py, t) => scan(py, t, HOLO_SCAN_MS);
  assert.ok(Math.abs(easeOutBack(0)) < 1e-9);
  assert.ok(Math.abs(easeOutBack(1) - 1) < 1e-9);
  assert.ok(Math.max(...[0.5, 0.6, 0.7, 0.8].map(easeOutBack)) > 1, "springs past full size before settling");
  for (let t = 0; t < HOLO_SCAN_MS; t += 100) for (const py of [-1, 0, 1]) { const v = scanBoost(py, t); assert.ok(v >= 0 && v <= 1); }
  const peak = Math.max(...Array.from({ length: 34 }, (_, i) => scanBoost(0, i * 100)));
  assert.ok(peak > 0.9, "the band crosses the equator");
  assert.ok(scanBoost(1, 0) < 0.01 && scanBoost(0, 0) > 0.9, "band starts at the equator and is narrow");
  for (let r = 0; r < 2; r += 1) for (let k = 0; k < HOLO_RING_POINTS; k += 7) {
    const p = ringPoint(r, k, 1.3);
    assert.ok(Math.abs(Math.hypot(p.x, p.y, p.z) - (1.18 + 0.12 * r)) < 1e-9, "points stay on the ring radius");
  }
  assert.notDeepEqual(ringPoint(0, 3, 0), ringPoint(0, 3, 1), "rings move with the spin");
});

test("the crystal is a deterministic once-subdivided icosahedron", () => {
  const { crystalGeometry } = require("../dist/apps/mobile/src/holoModel.js");
  const g = crystalGeometry();
  assert.equal(g.vertices.length, 42);
  assert.equal(g.edges.length, 120);
  for (const v of g.vertices) assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-9, "unit length");
  assert.ok(g.edges.every(([a, b]) => a !== b && a < 42 && b < 42));
  assert.equal(new Set(g.edges.map(([a, b]) => `${Math.min(a, b)}:${Math.max(a, b)}`)).size, 120, "no duplicate edges");
  assert.equal(crystalGeometry(), g, "cached");
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

test("the scan band moves geometry and brightness only, never the status colour", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync("apps/mobile/src/holoSphere.tsx", "utf8");
  assert.ok(!/HOLO_COLORS\.mint/.test(src), "no mint flash injected into the tone tint");
  assert.match(src, /holoColor\(px, py, pz, tone, s\.flash, s\.flashColor, s\.tintMix\)/);
  assert.match(src, /fieldMotion\.holoScanMs/);
});
