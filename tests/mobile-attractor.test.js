const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, "apps/mobile/src", file), "utf8");
const source = read("attractorModel.ts");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const shim = { exports: {} };
new Function("module", "exports", "require", compiled)(shim, shim.exports, require);
const { initialAttractorState, observeAttractor, tickAttractor, decisionTarget, iterateAttractor, ATTRACTOR_COLORS } = shim.exports;

test("attractor model is import-free and deterministic", () => {
  assert.doesNotMatch(source, /^import /m);
  assert.doesNotMatch(source, /Math\.random/);
  assert.deepEqual({ ...decisionTarget(7) }, { ...decisionTarget(7) });
});

test("the first observation only records the baseline", () => {
  const s = observeAttractor(initialAttractorState(), 100, 2);
  assert.equal(s.step, 0);
  assert.equal(s.bloom, 0);
});

test("a new decision moves the figure one step; no new decision leaves it alone", () => {
  let s = observeAttractor(initialAttractorState(), 100, 2);
  const same = observeAttractor(s, 100, 2);
  assert.equal(same.step, 0);
  s = observeAttractor(s, 101, 2);
  assert.equal(s.step, 1);
  assert.deepEqual({ ...s.target }, { ...decisionTarget(1) });
});

test("a new fill locks the symmetric form and blooms green, then relaxes to the tone", () => {
  let s = observeAttractor(observeAttractor(initialAttractorState(), 100, 2), 101, 3);
  assert.equal(s.bloom, 1);
  assert.equal(s.color, ATTRACTOR_COLORS.fill);
  assert.equal(s.target.c, s.target.d);
  for (let i = 0; i < 400; i += 1) s = tickAttractor(s, "normal");
  assert.ok(s.bloom < 0.01);
  assert.ok(Math.abs(s.color[0] - ATTRACTOR_COLORS.decide[0]) < 1);
});

test("held and halted runtimes tint the figure", () => {
  let hold = initialAttractorState(), halt = initialAttractorState();
  for (let i = 0; i < 400; i += 1) { hold = tickAttractor(hold, "hold"); halt = tickAttractor(halt, "halt"); }
  assert.ok(Math.abs(hold.color[0] - ATTRACTOR_COLORS.hold[0]) < 1);
  assert.ok(Math.abs(halt.color[0] - ATTRACTOR_COLORS.halt[0]) < 1);
});

test("iteration keeps points bounded on the attractor", () => {
  const xs = new Float32Array([0.1, -0.4]), ys = new Float32Array([0.3, 0.9]);
  for (let i = 0; i < 50; i += 1) iterateAttractor(xs, ys, initialAttractorState().params);
  for (const v of [...xs, ...ys]) assert.ok(Math.abs(v) <= 2.01);
});

test("every tab uses the attractor and none keeps the old contour core", () => {
  assert.match(read("decisionRings.tsx"), /<AttractorField decisionCount=\{model\.decisionCount\} fillCount=\{model\.paperOrderCount\}/);
  assert.match(read("fieldHeader.tsx"), /<AttractorField /);
  assert.match(read("moreMenuView.tsx"), /<AttractorField /);
  assert.ok(!fs.existsSync(path.join(root, "apps/mobile/src/contourCore.tsx")));
  const field = read("attractorField.tsx");
  assert.match(field, /if \(reducedMotion \|\| decisionCount == null\)/);
  assert.match(field, /cancelAnimationFrame\(frame\)/);
});
