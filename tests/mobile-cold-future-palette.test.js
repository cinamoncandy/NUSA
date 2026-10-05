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
  for (let i = 0; i < 120; i += 1) { s = tickHolo(s, "halt", 42, 1000 + i * 42); seen.push(s.tintMix); }
  assert.ok(seen[0] > 0 && seen[0] < 0.2, "starts gently");
  assert.ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]), "monotonic");
  assert.equal(seen[seen.length - 1], 1);
  for (let i = 0; i < 160; i += 1) s = tickHolo(s, "normal", 42, 9000 + i * 42);
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
