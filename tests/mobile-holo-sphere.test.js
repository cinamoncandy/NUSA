const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, "apps/mobile/src", file), "utf8");
const source = read("holoModel.ts");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const shim = { exports: {} };
new Function("module", "exports", "require", compiled)(shim, shim.exports, require);
const { initialHoloState, observeHolo, tickHolo, isHoloQuiet, spherePoints, waveDisplacement, holoColor, HOLO_COLORS, HOLO_WAVE_MS } = shim.exports;

test("holo model is import-free and the sphere points are unit vectors", () => {
  assert.doesNotMatch(source, /^import /m);
  const pts = spherePoints(200);
  for (let i = 0; i < 200; i += 1) assert.ok(Math.abs(Math.hypot(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]) - 1) < 1e-5);
});

test("the first observation and a counter reset only set a baseline", () => {
  const base = observeHolo(initialHoloState(), 100, 2, 0);
  assert.equal(base.waves.length, 0);
  const reset = observeHolo(base, 3, 0, 10);
  assert.equal(reset.waves.length, 0);
  assert.equal(reset.burstTarget, 0);
});

test("new decisions send waves (at most three per poll); a new order starts the ring burst", () => {
  const base = observeHolo(initialHoloState(), 100, 2, 0);
  assert.equal(observeHolo(base, 101, 2, 0).waves.length, 1);
  assert.equal(observeHolo(base, 140, 2, 0).waves.length, 3);
  const fill = observeHolo(base, 101, 3, 0);
  assert.equal(fill.burstTarget, 1);
  assert.equal(fill.flashColor, HOLO_COLORS.fill);
});

test("waves expire, the burst returns, and the sphere goes quiet", () => {
  let s = observeHolo(observeHolo(initialHoloState(), 100, 2, 0), 101, 3, 0);
  let now = 0;
  for (let i = 0; i < 600; i += 1) { now += 42; s = tickHolo(s, "normal", 42, now); }
  assert.ok(now > HOLO_WAVE_MS);
  assert.equal(s.waves.length, 0);
  assert.equal(s.burst, 0);
  assert.ok(isHoloQuiet(s));
});

test("a wave lifts the surface only near its front", () => {
  const wave = [{ bornMs: 0, ax: 0, ay: 1, az: 0, amp: 0.09 }];
  const t = HOLO_WAVE_MS * 0.25; // front at 45 degrees from the pole
  const near = waveDisplacement(wave, Math.sin(Math.PI / 4), Math.cos(Math.PI / 4), 0, t);
  const far = waveDisplacement(wave, 0, -1, 0, t);
  assert.ok(near > 0.03 && far < 1e-6);
});

test("held and halted runtimes tint the sphere", () => {
  const hold = holoColor(1, 0, 0, "hold", 0, HOLO_COLORS.cyan);
  const halt = holoColor(1, 0, 0, "halt", 0, HOLO_COLORS.cyan);
  assert.ok(hold[0] > 200 && hold[2] < 160);
  assert.ok(halt[0] > 200 && halt[1] < 140);
});

test("every tab uses the holo sphere; the attractor is gone; motion is throttled", () => {
  assert.match(read("decisionRings.tsx"), /<HoloSphere decisionCount=\{model\.decisionCount\} fillCount=\{model\.paperOrderCount\}/);
  assert.match(read("fieldHeader.tsx"), /<HoloSphere decisionCount=\{null\}/);
  assert.match(read("moreMenuView.tsx"), /<HoloSphere decisionCount=\{null\}/);
  for (const gone of ["attractorField.tsx", "attractorModel.ts"]) assert.ok(!fs.existsSync(path.join(root, "apps/mobile/src", gone)));
  const view = read("holoSphere.tsx");
  assert.match(view, /holoFrameBudgetMs\(isHoloQuiet\(state\.current\)\)/);
  assert.ok(!/const (QUIET|ACTIVE)_FRAME_MS/.test(view), "budgets live in the model, not in the presenter");
  assert.match(view, /if \(reducedMotion \|\| decisionCount == null\)/);
  assert.match(view, /cancelAnimationFrame\(frame\)/);
});

test("neon ridge: near and wave-lit ridges lean neon, and the neon fades with the tone transition", () => {
  const { ridgeNeonInk, RIDGE_NEON } = shim.exports;
  const ink = HOLO_COLORS.ink;
  assert.deepEqual(ridgeNeonInk(ink, 1, 0, 0), ink, "the horizon keeps the cool white ink");
  const closer = (c) => Math.abs(c[0] - RIDGE_NEON[0]) < Math.abs(ink[0] - RIDGE_NEON[0]);
  assert.ok(closer(ridgeNeonInk(ink, 0, 0, 0)), "a near ridge leans neon");
  assert.ok(closer(ridgeNeonInk(ink, 1, 1, 0)), "a wave-lit horizon ridge leans neon");
  // Entering hold / halt: tintMix eases 0 -> 1, so the neon must ease out with it, never jump.
  const steps = [0, 0.25, 0.5, 0.75, 1].map((m) => Math.abs(ridgeNeonInk(ink, 0, 1, m)[0] - ink[0]));
  for (let i = 1; i < steps.length; i += 1) assert.ok(steps[i] < steps[i - 1], "neon strength falls monotonically with tintMix");
  assert.deepEqual(ridgeNeonInk(ink, 0, 1, 1), ink, "a fully tinted hold / halt ridge has no neon left");
  assert.deepEqual(ridgeNeonInk(ink, 0, 1, 7), ink, "tintMix is clamped");
});

test("glow rows stay bounded even when many wave fronts light most rows", () => {
  const { ridgeGlowsRow, RIDGE_GLOW_LIT_MAX, RIDGE_ROWS } = shim.exports;
  assert.equal(ridgeGlowsRow(1, 0.9, 0, 0, 0), false, "a quiet far row draws no glow");
  assert.equal(ridgeGlowsRow(1, 0.9, 0.5, 0, 0), true, "a wave-lit row glows while budget remains");
  assert.equal(ridgeGlowsRow(1, 0.9, 0, 0.4, 0), true, "an order-lit row glows while budget remains");
  assert.equal(ridgeGlowsRow(1, 0.9, 0.9, 0.9, RIDGE_GLOW_LIT_MAX), false, "no lit row glows once the per-frame cap is spent");
  // Worst case: every row is wave-lit. Count the blurred passes a frame would draw.
  let lit = 0, drawn = 0;
  for (let r = RIDGE_ROWS - 1; r >= 0; r -= 1) {
    const depth = r / (RIDGE_ROWS - 1);
    if (ridgeGlowsRow(r, depth, 0.9, 0, lit)) { drawn += 1; lit += 1; }
  }
  const nearRows = Array.from({ length: RIDGE_ROWS }, (_, r) => r).filter((r) => r / (RIDGE_ROWS - 1) < 0.3 && r % 3 === 0).length;
  assert.ok(drawn <= RIDGE_GLOW_LIT_MAX + nearRows, `at most ${RIDGE_GLOW_LIT_MAX + nearRows} glow passes, got ${drawn}`);
  assert.ok(drawn < RIDGE_ROWS / 2, "far fewer glow passes than rows");
});

test("ridge depth sway and horizon light stay bounded", () => {
  const { ridgeSway, ridgeHorizonGlow, RIDGE_SWAY } = shim.exports;
  assert.equal(ridgeSway(1, 5), 0, "the horizon never sways");
  let maxNear = 0, maxMid = 0;
  for (let t = 0; t < 60; t += 0.25) { maxNear = Math.max(maxNear, Math.abs(ridgeSway(0, t))); maxMid = Math.max(maxMid, Math.abs(ridgeSway(0.5, t))); }
  assert.ok(maxNear > maxMid && maxMid > 0, "nearer ridges drift more");
  assert.ok(maxNear <= RIDGE_SWAY + 1e-9, "sway is bounded");
  for (let t = 0; t < 30; t += 0.5) for (const burst of [0, 0.5, 1, 3, -1]) {
    const g = ridgeHorizonGlow(t, burst);
    assert.ok(g >= 0 && g <= 1, `horizon glow ${g} stays within 0..1`);
  }
});
