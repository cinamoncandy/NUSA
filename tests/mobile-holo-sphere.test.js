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

test("an order is stamped when observed, expires after its lifetime, and keeps the figure out of the quiet budget meanwhile", () => {
  const { initialHoloState, observeHolo, tickHolo, isHoloQuiet, HOLO_ORDER_MS } = shim.exports;
  const base = { ...observeHolo(initialHoloState(), 100, 2, 0), birth: 1 };
  assert.equal(base.orderBornMs, null, "the first observation only sets a baseline");
  const ordered = observeHolo(base, 101, 3, 5_000);
  assert.equal(ordered.orderBornMs, 5_000);
  assert.equal(observeHolo(base, 101, 2, 5_000).orderBornMs, null, "a decision alone is not an order");
  assert.equal(isHoloQuiet({ ...ordered, waves: [], burst: 0, burstTarget: 0, flash: 0 }), false, "sparks and rings are still in flight");
  const during = tickHolo(ordered, "normal", 16, 5_000 + HOLO_ORDER_MS - 1);
  assert.equal(during.orderBornMs, 5_000);
  const after = tickHolo(ordered, "normal", 16, 5_000 + HOLO_ORDER_MS);
  assert.equal(after.orderBornMs, null, "the order expires");
});

test("decision comets travel the chain stream by stream, deterministically and only within their life", () => {
  const M = shim.exports;
  const wave = M.waveFor(7, 10_000);
  assert.equal(M.flowCometProgress(wave, 0, 0, 9_999), null, "not before the decision");
  for (let e = 1; e < M.FLOW_EDGES.length; e += 1) assert.ok(M.flowCometDelaySec(e) > M.flowCometDelaySec(e - 1), "each stream launches after the one before it");
  const first = M.flowCometProgress(wave, 0, 0, 10_000 + 600), later = M.flowCometProgress(wave, 0, 0, 10_000 + 900);
  assert.ok(first != null && later != null && later > first, "a comet advances toward the target");
  assert.equal(M.flowCometProgress(wave, 0, 0, 10_000 + 600), first, "deterministic");
  assert.equal(M.flowCometProgress(wave, 0, 0, 10_000 + 3_000), null, "gone once it arrives");
  assert.equal(M.flowCometProgress(wave, 4, 0, 10_000 + 100), null, "the last stream has not launched yet");
  for (const edge of [0, 2, 4]) for (let i = 0; i < M.FLOW_COMETS_PER_EDGE; i += 1) {
    const strand = M.flowCometStrand(edge, i, 90);
    assert.ok(Number.isInteger(strand) && strand >= 0 && strand < 90, "a comet rides a real strand");
  }
  assert.equal(M.flowCometStrand(1, 1, 0), 0, "an empty bundle never yields a negative index");
});

test("a comet's tail trails behind its head and fades, ambient comets stay on their stream", () => {
  const M = shim.exports;
  const head = M.flowTailProgress(0.5, 0), end = M.flowTailProgress(0.5, M.FLOW_COMET_TAIL_POINTS - 1);
  assert.equal(head, 0.5);
  assert.ok(end < head && Math.abs(head - end - M.FLOW_COMET_TAIL) < 1e-9, "the tail trails by its length");
  assert.equal(M.flowTailProgress(0.02, 4), 0, "the tail clamps at the source instead of leaving the stream");
  assert.ok(M.flowTailLight(0) > M.flowTailLight(5) && M.flowTailLight(5) > M.flowTailLight(8), "brightness fades along the tail");
  const strand = { speed: 1, phase: 3 };
  for (const t of [0, 1.3, 55, 5_000]) { const u = M.flowAmbientComet(strand, t); assert.ok(u >= 0 && u < 1, "an ambient comet stays inside its stream"); }
});

test("order sparks and rings are deterministic, bounded and expire", () => {
  const M = shim.exports;
  const a = M.flowSpark(3, 0.4), b = M.flowSpark(3, 0.4);
  assert.deepEqual(a, b, "deterministic");
  let alive = 0;
  for (let i = 0; i < M.FLOW_SPARKS; i += 1) {
    assert.equal(M.flowSpark(i, 5), null, "every spark is gone after five seconds");
    const sp = M.flowSpark(i, 0.1);
    if (sp != null) { alive += 1; assert.ok(sp.life > 0 && sp.life <= 1 && sp.x > -0.5 && sp.x < 1.5 && sp.y > -0.5 && sp.y < 1.5, "sparks stay near the canvas"); }
  }
  assert.ok(alive > M.FLOW_SPARKS * 0.9, "almost all sparks fly early on");
  assert.equal(M.flowSpark(0, -1), null, "none before the order");
  assert.equal(M.flowOrderRing(0, -0.1), null);
  assert.ok(M.flowOrderRing(0, 0.5).scale > 0.9 && M.flowOrderRing(0, 0.5).alpha > 0);
  assert.equal(M.flowOrderRing(1, 0.2), null, "the second ring waits for its stagger");
  assert.ok(M.flowOrderRing(2, 1.0) != null);
  assert.equal(M.flowOrderRing(0, 2), null, "rings expire");
  assert.ok(M.flowOrderRing(0, 1.2).scale > M.flowOrderRing(0, 0.4).scale, "rings open outward");
  assert.equal(M.flowArrivalRing(0.1), null);
  assert.ok(M.flowArrivalRing(0.9).alpha > M.flowArrivalRing(0.3).alpha);
});

test("clusters breathe, lift when lit, and turn each particle at its own rate", () => {
  const M = shim.exports;
  assert.notEqual(M.flowBreath(0, 0, 0, 0), M.flowBreath(0, 2, 0, 0), "an idle cluster swells and settles");
  assert.ok(M.flowBreath(2, 1, 1, 0) > M.flowBreath(2, 1, 0, 0), "a landing pulse lifts it");
  assert.ok(M.flowBreath(3, 1, 0, 1) > M.flowBreath(3, 1, 1, 0), "an order lifts the paper cluster more");
  for (let t = 0; t < 20; t += 0.7) assert.ok(M.flowBreath(1, t, 0, 0) > 0.9 && M.flowBreath(1, t, 0, 0) < 1.1, "idle breathing is gentle");
  assert.ok(M.flowParticleSwirl(0.1) < M.flowParticleSwirl(0.9), "particles turn at different rates");
  for (const m of [0, 0.3, 1]) for (const t of [0, 1.9, 77]) { const w = M.flowParticleTwinkle(m, t); assert.ok(w >= 0.2 && w <= 1, "twinkle stays a brightness factor"); }
});
