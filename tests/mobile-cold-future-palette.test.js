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
  assert.ok(contrast(colors.textMuted, colors.background) >= 6, "secondary text");
  assert.ok(contrast(colors.textMuted, colors.surface) >= 6, "secondary text on cards");
  assert.ok(contrast(colors.primary, colors.background) >= 10, "primary control against the ground");
  assert.ok(contrast(colors.onPrimary, colors.primary) >= 10, "label on a primary button");
  assert.ok(contrast(colors.focus, colors.background) >= 7, "focus ring");
});

test("calm-v1: white is the normal tone; nothing else can be mistaken for attention or loss", () => {
  // In calm-v1 white is both the primary and the healthy/normal tone (owner-approved board), so only amber and red are alarm colours.
  const decorative = { primary: colors.primary, focus: colors.focus, info: colors.info, text: colors.text, neonPurple: colors.neonPurple, neonBlue: colors.neonBlue };
  const status = { warning: colors.warning, danger: colors.danger };
  assert.equal(colors.success, colors.text, "normal reads as plain white");
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


test("the ridge hero is deterministic and stays inside the canvas", () => {
  const M = require("../dist/apps/mobile/src/holoModel.js");
  assert.equal(M.ridgeNoise(1.3, 2.7), M.ridgeNoise(1.3, 2.7), "deterministic terrain");
  for (const rows of [M.RIDGE_ROWS, 16]) for (const t of [0, 1.7, 40, 5000]) {
    let prev = -1;
    for (let r = 0; r < rows; r += 1) {
      const d = M.ridgeDepth(r, rows, t);
      assert.ok(d > 0 && d <= 1, "depth stays in 0..1");
      assert.ok(d > prev, "rows stay ordered near to far");
      prev = d;
      const base = M.ridgeBaseY(d);
      assert.ok(base >= M.RIDGE_HORIZON - 1e-9 && base <= M.RIDGE_NEAR + 1e-9, "a ridge sits between the horizon and the near edge");
      for (const u of [0, 0.25, 0.5, 0.56, 1]) for (const rise of [0, 1]) {
        const h = M.ridgeHeight(u, d, t, rise), x = M.ridgeX(u, d);
        assert.ok(h >= 0 && base - h >= 0, "peaks never leave the top of the canvas");
        assert.ok(x > -0.2 && x < 1.2, "the landscape stays near the canvas");
      }
    }
  }
  assert.ok(M.ridgeBaseY(0.01) > M.ridgeBaseY(0.9), "near rows sit lower than far rows");
  assert.ok(M.ridgeRowAlpha(0.05) > M.ridgeRowAlpha(0.9), "near rows are brighter");
  assert.notEqual(M.ridgeDepth(3, M.RIDGE_ROWS, 0), M.ridgeDepth(3, M.RIDGE_ROWS, 0.2), "the landscape flows toward the viewer");
});

test("a decision's wave rolls from the horizon toward the viewer, and an order raises a lime peak", () => {
  const M = require("../dist/apps/mobile/src/holoModel.js");
  const wave = M.waveFor(4, 1000);
  assert.equal(M.ridgeWaveGlow(wave, 0.5, 999), 0, "not before it is born");
  assert.equal(M.ridgeWaveGlow(wave, 0.5, 1000 + M.HOLO_WAVE_MS), 0, "gone after its lifetime");
  assert.ok(M.ridgeWaveGlow(wave, 0.99, 1010) > 0, "born on the horizon");
  assert.ok(M.ridgeWaveGlow(wave, 0.5, 1000 + M.HOLO_WAVE_MS / 2) > 0, "half way, half way across");
  assert.equal(M.ridgeWaveGlow(wave, 0.1, 1010), 0, "not near the viewer at birth");
  assert.ok(M.ridgeHeight(M.RIDGE_ORDER_U, M.RIDGE_ORDER_DEPTH, 0, 1) > M.ridgeHeight(M.RIDGE_ORDER_U, M.RIDGE_ORDER_DEPTH, 0, 0) + 0.1, "an order raises a peak");
  assert.ok(M.ridgeOrderMix(M.RIDGE_ORDER_DEPTH, 1) > 0.9 && M.ridgeOrderMix(0.9, 1) === 0 && M.ridgeOrderMix(M.RIDGE_ORDER_DEPTH, 0) === 0, "only the order's ridge turns lime, and only while it rises");
});

test("the renderer draws far to near with ground fill, keeps tone ink, and reserves lime for the order", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "apps", "mobile", "src", "holoSphere.tsx"), "utf8");
  assert.match(src, /for \(let r = rows - 1; r >= 0; r -= 1\)/, "far rows first so nearer ridges hide them");
  assert.match(src, /canvas\.drawPath\(fill, paints\.ground\)/, "occlusion by ground fill");
  assert.match(src, /const ink = holoInk\(tone, s\.tintMix\)/, "hold / halt tint the ink");
  assert.match(src, /const accent = tone === "normal" \? HOLO_COLORS\.lime : ink/, "no lime while held or halted");
  assert.ok(!/HOLO_COLORS\.lime/.test(src.replace(/const accent[^\n]*\n/, "")), "lime is used only for the accent");
  assert.match(src, /try \{ glow\.setMaskFilter/, "blur is guarded");
  assert.match(src, /if \(reducedMotion \|\| decisionCount == null\)/, "still figure contract");
  assert.ok(!/flowLines|wallRows|flowArcX|burstStreaks|dustField/.test(src), "old figures are gone");
});
