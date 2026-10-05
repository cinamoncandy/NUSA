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
  assert.match(view, /const QUIET_FRAME_MS = 56;/);
  assert.match(view, /if \(reducedMotion \|\| decisionCount == null\)/);
  assert.match(view, /cancelAnimationFrame\(frame\)/);
});
