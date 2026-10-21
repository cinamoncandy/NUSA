import assert from "node:assert/strict";
import { test } from "node:test";
import { BURST_MS, CORE_POINTS, WAVE_MS, buildCoreLinks, burstsForOrders, coreMotion, fibonacciSphere, projectCore, waveLight, wavesForDecisions, type Vec3 } from "./decisionCoreModel";

test("the lattice puts every point on the unit sphere and links only near neighbours", () => {
  const pts = fibonacciSphere(CORE_POINTS);
  assert.equal(pts.length, CORE_POINTS);
  for (const p of pts) assert.ok(Math.abs(Math.hypot(p[0], p[1], p[2]) - 1) < 1e-9);
  const links = buildCoreLinks(pts);
  assert.ok(links.length > CORE_POINTS / 2 && links.length <= CORE_POINTS);
  for (const [i, j] of links) { const a = pts[i]!, b = pts[j]!; assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.25); }
});

test("a wave lights the ring at its front, then fades and is gone after its lifetime", () => {
  const origin: Vec3 = [0, 0, 1];
  const waves = [{ origin, born: 0 }];
  const atFront: Vec3 = [Math.sin(0.75), 0, Math.cos(0.75)]; // 0.75 rad from the origin = the front at 0.5 s
  assert.ok(waveLight(atFront, waves, 500) > 0.6);
  assert.ok(waveLight([0, 0, -1], waves, 500) < 0.01);
  assert.equal(waveLight(atFront, waves, WAVE_MS + 1), 0);
  assert.equal(waveLight(atFront, [{ origin, born: 1000 }], 500), 0, "a wave scheduled for later does not light yet");
});

test("only a real rise in the decision count makes waves, capped and spread out", () => {
  const pick = (): Vec3 => [0, 1, 0];
  assert.deepEqual(wavesForDecisions(null, 10, 0, pick), [], "a first reading is not a new decision");
  assert.deepEqual(wavesForDecisions(10, 10, 0, pick), []);
  assert.deepEqual(wavesForDecisions(10, 3, 0, pick), [], "a new day resets, it is not a decision");
  assert.equal(wavesForDecisions(10, 11, 0, pick).length, 1);
  const many = wavesForDecisions(10, 500, 0, pick);
  assert.equal(many.length, 4);
  assert.deepEqual(many.map((w) => w.born), [0, 750, 1500, 2250]);
});

test("only a real rise in the order count throws sparks", () => {
  const pick = (): Vec3 => [1, 0, 0];
  let s = 0.1; const rand = () => (s = (s * 9301 + 0.49297) % 1);
  assert.deepEqual(burstsForOrders(null, 2, 0, pick, rand), []);
  assert.deepEqual(burstsForOrders(2, 2, 0, pick, rand), []);
  const bursts = burstsForOrders(2, 9, 0, pick, rand);
  assert.equal(bursts.length, 2);
  assert.ok(bursts[0]!.dirs.every((d) => Math.abs(Math.hypot(d[0], d[1], d[2]) - 1) < 1e-9));
  assert.ok(BURST_MS > 1000);
});

test("the limit tone cools: slower turn and breath than live, and it shrinks a little", () => {
  const live = coreMotion("live"), limit = coreMotion("limit"), idle = coreMotion("idle");
  assert.ok(limit.spin < idle.spin && idle.spin < live.spin);
  assert.ok(limit.breath < live.breath && limit.shrink > 0 && live.shrink === 0);
});

test("projection keeps the centre fixed and puts nearer points larger", () => {
  const front = projectCore([0, 0, -1], 0, 0, 100, 100, 50, 1), back = projectCore([0, 0, 1], 0, 0, 100, 100, 50, 1);
  assert.equal(front.x, 100); assert.equal(front.y, 100);
  assert.ok(front.f > back.f && front.z < 0);
});
