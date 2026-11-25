"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const m = require("../dist/apps/mobile/src/latticeSphereModel.js");
const read = (f) => fs.readFileSync(`apps/mobile/src/${f}`, "utf8").replace(/\r\n/g, "\n");

test("the lattice is the same 162 nodes and 480 edges every time, all on the unit sphere, every edge once", () => {
  const a = m.buildLattice(), b = m.buildLattice();
  assert.equal(a, b, "built once");
  assert.equal(a.vertices.length, m.LATTICE_NODE_COUNT);
  assert.equal(a.edges.length, m.LATTICE_EDGE_COUNT);
  for (const v of a.vertices) assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-9);
  assert.equal(new Set(a.edges.map(([p, q]) => `${p}-${q}`)).size, a.edges.length);
  for (const [p, q] of a.edges) assert.ok(p < q && p >= 0 && q < a.vertices.length);
  // every node has 5 or 6 neighbours (an icosphere)
  const deg = new Array(a.vertices.length).fill(0);
  for (const [p, q] of a.edges) { deg[p] += 1; deg[q] += 1; }
  assert.ok(deg.every((d) => d === 5 || d === 6));
});

test("rotate and unrotate are inverses, so a ring origin stays on the same spot of the sphere as it turns", () => {
  for (const p of [[0, 0, 1], [0.6, 0.64, 0.48], [-0.3, 0.2, -0.93]]) {
    const q = m.unrotate(m.rotate(p, 0.9, m.LATTICE_TILT), 0.9, m.LATTICE_TILT);
    for (let i = 0; i < 3; i += 1) assert.ok(Math.abs(q[i] - p[i]) < 1e-9);
  }
});

test("the sphere turns only while live and allowed to move; otherwise one fixed pose", () => {
  assert.equal(m.latticeYaw(50, false, true), m.LATTICE_REST_YAW, "no data");
  assert.equal(m.latticeYaw(50, true, false), m.LATTICE_REST_YAW, "reduce-motion or the OS has not answered");
  assert.equal(m.latticeYaw(Number.NaN, true, true), m.LATTICE_REST_YAW);
  assert.ok(m.latticeYaw(10, true, true) > m.LATTICE_REST_YAW);
});

test("it never lights by itself: no pulse, no light; a pulse is a ring that travels and fades; a fill washes the whole sphere briefly", () => {
  const v = [0, 0, 1];
  assert.deepEqual(m.nodeLight(v, [], 1000), { light: 0, order: 0 });
  assert.equal(m.pulseLight(0, -5), 0);
  assert.equal(m.pulseLight(0, m.LATTICE_PULSE_MS + 1), 0);
  assert.ok(m.pulseLight(0, 10) > 0.9, "the origin lights at the start");
  assert.ok(m.pulseLight(0, m.LATTICE_PULSE_MS * 0.5) < 0.05, "and has been passed by the ring later");
  assert.ok(m.pulseLight(Math.PI * 0.5, m.LATTICE_PULSE_MS * 0.5 / 1.05 * 1.0) > 0.3, "the ring is over the equator around half way");
  const order = { born: 0, order: true, origin: [0, 0, 1] };
  assert.ok(m.nodeLight(v, [order], 10).order > 0.9);
  assert.equal(m.nodeLight(v, [{ ...order, order: false }], 10).order, 0);
  assert.equal(m.fillWash(-1), 0);
  assert.ok(m.fillWash(200) > 0.5);
  assert.equal(m.fillWash(m.LATTICE_FILL_MS + 1), 0);
});

test("pulses come only from real rises, capped, with the last ones as order pulses", () => {
  const o = [0, 0, 1];
  assert.equal(m.pulsesForCounts(null, 5, null, 1, 0, o).length, 0, "no previous count: nothing");
  assert.equal(m.pulsesForCounts(5, 5, 1, 1, 0, o).length, 0);
  assert.equal(m.pulsesForCounts(5, 3, 1, 0, 0, o).length, 0, "a fall is not a rise");
  assert.equal(m.pulsesForCounts(0, 100, 0, 0, 0, o).length, m.LATTICE_MAX_PULSES);
  const p = m.pulsesForCounts(0, 3, 0, 1, 1000, o);
  assert.deepEqual(p.map((x) => x.order), [false, false, true]);
  assert.ok(p[1].born > p[0].born, "staggered");
  assert.equal(m.pulsesForCounts(0, 1.5, 0, 0, 0, o).length, 0, "non-integers are ignored");
});

test("nodes are dimmer and greyer without data; back nodes are small and faint", () => {
  assert.ok(m.nodeOpacity(1, false) < m.nodeOpacity(1, true));
  assert.ok(m.nodeOpacity(-0.5, true) < m.nodeOpacity(0.5, true));
  assert.ok(m.nodeRadius(-0.5, 1) < m.nodeRadius(0.9, 1));
});

test("source pin: 지금 draws the sphere from the counts it has, never for the still islands, and the sphere reads no data of its own", () => {
  const now = read("instrumentNow.tsx");
  assert.match(now, /<LatticeSphere decisionCount=\{live \? decisionCount : null\} orderCount=\{live \? orderCount : null\} fillCount=\{live \? fillCount : null\} live=\{live && tone === "NORMAL"\}/);
  assert.doesNotMatch(now, /IslandCore/, "the island is gone from 지금");
  const sphere = read("latticeSphere.tsx");
  assert.doesNotMatch(sphere, /fetch\(|decisionTrace|Math\.random/);
  assert.match(sphere, /const moving = reducedMotion === false;/, "still until the OS answers and under reduce-motion");
  assert.match(sphere, /live \? nodeLight\(v, shown, now\) : \{ light: 0, order: 0 \}/, "no light without data");
  assert.doesNotMatch(read("latticeSphereModel.ts"), /Math\.random|Date\.now/, "pure");
});

test("without motion nothing travels: a rise is a brief still highlight, then nothing", () => {
  assert.equal(m.staticPulseMs(-1), Number.POSITIVE_INFINITY);
  assert.equal(m.staticPulseMs(0), 40);
  assert.equal(m.staticPulseMs(m.LATTICE_STATIC_MS - 1), 40, "the same early frame the whole time");
  assert.equal(m.staticPulseMs(m.LATTICE_STATIC_MS), Number.POSITIVE_INFINITY);
  assert.ok(m.pulseLight(0, m.staticPulseMs(10)) > 0.9, "the origin is lit");
  assert.equal(m.pulseLight(0, m.staticPulseMs(m.LATTICE_STATIC_MS + 5)), 0, "and then it is gone");
  const src = read("latticeSphere.tsx");
  assert.match(src, /if \(!active \|\| !moving\) return undefined;/, "no frame loop without motion");
  assert.match(src, /moving \? now - p\.born : staticPulseMs\(now - p\.born\)/);
  assert.match(src, /const turning = moving && live && !still;/);
  assert.match(src, /t\.acc \+= /, "the angle is kept when turning stops, so it never jumps");
  assert.doesNotMatch(src.slice(src.indexOf("const scene = useMemo")), /pulses\.current = /, "the scene memo has no side effects on the pulses");
});

test("the plain nodes are drawn as a few point sets, not one element per node", () => {
  const src = read("latticeSphere.tsx");
  assert.match(src, /import \{[^}]*\bPoints\b[^}]*\} from "@shopify\/react-native-skia"/);
  assert.match(src, /scene\.plain\.map\(\(pts, b\) =>/);
  assert.doesNotMatch(src, /scene\.nodes\.map/, "no per-node element list");
});
