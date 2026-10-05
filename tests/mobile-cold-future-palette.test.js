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

test("fill expansion keeps the rings inside the canvas, the core follows the status tone, and presenters share the radius tokens", () => {
  const fs = require("node:fs");
  const { HOLO_FILL_EXPANSION, holoColor, HOLO_COLORS } = require("../dist/apps/mobile/src/holoModel.js");
  const { fieldRadii, createTheme } = require("../dist/apps/mobile/src/designSystem.js");
  // Worst case: outermost layer (scale 1.04) at the maximum liquid radius 1.25, full fill, breath 2.5%, on R = 0.33 of the canvas.
  assert.ok(1.04 * 1.25 * (1 + HOLO_FILL_EXPANSION) * 1.025 * 0.33 < 0.5, "extent below the canvas half-width");
  const core = (tone) => holoColor(0, 0, 1, tone, 0, HOLO_COLORS.cyan, 1);
  assert.ok(core("halt")[0] > core("halt")[2] + 60, "halt core reads red, not cyan");
  assert.ok(core("hold")[0] > core("hold")[2] + 60, "hold core reads amber, not cyan");
  assert.ok(core("normal")[2] >= core("normal")[0], "normal core is cool");
  const radii = createTheme("dark").radii;
  assert.deepEqual({ md: radii.md, lg: radii.lg, xl: radii.xl }, fieldRadii, "static radii match the theme");
  const dir = "apps/mobile/src";
  const offenders = fs.readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f)).filter((f) => /borderRadius: (10|12|14|16|18|20)\b/.test(fs.readFileSync(`${dir}/${f}`, "utf8")));
  assert.deepEqual(offenders, [], "card and control radii come from fieldRadii");
  assert.ok(!/고리로/.test(fs.readFileSync(`${dir}/decisionRings.tsx`, "utf8")), "legend no longer promises a ring");
});

test("liquid rings are deterministic, bounded, flow with time and react to runtime waves", () => {
  const { liquidRadius, easeOutBack, LIQUID_LAYERS, LIQUID_SEGMENTS, waveFor } = require("../dist/apps/mobile/src/holoModel.js");
  const { fieldMotion } = require("../dist/apps/mobile/src/designSystem.js");
  const flow = fieldMotion.holoFlowMs / 1000;
  assert.ok(Math.abs(easeOutBack(0)) < 1e-9 && Math.abs(easeOutBack(1) - 1) < 1e-9);
  assert.ok(Math.max(...[0.5, 0.6, 0.7, 0.8].map(easeOutBack)) > 1, "springs past full size before settling");
  assert.equal(LIQUID_LAYERS, 4);
  for (let layer = 0; layer < LIQUID_LAYERS; layer += 1) for (let i = 0; i < LIQUID_SEGMENTS; i += 1) {
    const r = liquidRadius((i / LIQUID_SEGMENTS) * Math.PI * 2, layer, 3.3, flow, [], 0);
    assert.ok(r >= 0.78 && r <= 1.25, `layer ${layer} radius ${r} in bounds`);
  }
  assert.equal(liquidRadius(1, 0, 2, flow, [], 0), liquidRadius(1, 0, 2, flow, [], 0), "deterministic");
  assert.notEqual(liquidRadius(1, 0, 0, flow, [], 0), liquidRadius(1, 0, 1.5, flow, [], 0), "flows with time");
  assert.notEqual(liquidRadius(1, 0, 2, flow, [], 0), liquidRadius(1, 1, 2, flow, [], 0), "layers differ");
  const wave = waveFor(5, 1000);
  const seen = Array.from({ length: 48 }, (_, i) => liquidRadius((i / 48) * Math.PI * 2, 0, 2, flow, [wave], 1500) - liquidRadius((i / 48) * Math.PI * 2, 0, 2, flow, [], 1500));
  assert.ok(Math.max(...seen) > 0.02, "a decision wave bumps the ring somewhere");
  assert.ok(seen.every((v) => Math.abs(v) < 0.35), "and stays gentle");
});

test("the hero is drawn as liquid rings and keeps its tone and still-figure contract", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync("apps/mobile/src/holoSphere.tsx", "utf8");
  assert.match(src, /liquidRadius\(/);
  assert.match(src, /fieldMotion\.holoFlowMs/);
  assert.match(src, /holoColor\([^)]*tone[^)]*s\.tintMix\)/);
  assert.ok(!/crystalGeometry|scanBoost|ringPoint/.test(src), "old figures are gone");
});
