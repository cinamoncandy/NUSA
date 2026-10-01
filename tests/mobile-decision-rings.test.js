const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "apps/mobile/src/decisionRingsModel.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
}).outputText;
const moduleShim = { exports: {} };
new Function("module", "exports", "require", compiled)(moduleShim, moduleShim.exports, require);
const { buildDecisionRings } = moduleShim.exports;

test("decision rings model stays import-free so it can be transpiled alone", () => {
  assert.doesNotMatch(source, /^import /m);
});

test("unknown decision count draws nothing and claims nothing", () => {
  const rings = buildDecisionRings({ decisionCount: null, paperOrderCount: null });
  assert.equal(rings.state, "UNKNOWN");
  assert.equal(rings.dots.length, 0);
  assert.equal(rings.decisionCount, null);
  assert.match(rings.headline, /받지 못했습니다/);
});

test("waiting runtime shows the real count and no order claim", () => {
  const rings = buildDecisionRings({ decisionCount: 3074, paperOrderCount: 0 });
  assert.equal(rings.state, "WAITING");
  assert.equal(rings.headline, "3,074번 판단");
  assert.match(rings.detail, /주문하지 않았습니다/);
});

test("large histories are sampled to the dot budget, oldest at centre and newest at edge", () => {
  const rings = buildDecisionRings({ decisionCount: 3074, paperOrderCount: 0, maxDots: 400 });
  assert.equal(rings.dots.length, 400);
  assert.ok(Math.abs(rings.decisionsPerDot - 3074 / 400) < 1e-9);
  const r = (d) => Math.hypot(d.x, d.y);
  assert.ok(r(rings.dots[0]) < 0.1);
  assert.ok(r(rings.dots[399]) > 0.99 && r(rings.dots[399]) <= 1);
  assert.equal(rings.dots[0].recency, 0);
  assert.equal(rings.dots[399].recency, 1);
  for (const dot of rings.dots) assert.ok(r(dot) <= 1 + 1e-9);
});

test("small histories draw one dot per decision", () => {
  const rings = buildDecisionRings({ decisionCount: 3, paperOrderCount: 0 });
  assert.equal(rings.dots.length, 3);
  assert.equal(rings.decisionsPerDot, 1);
});

test("orders switch the state and are reported by count", () => {
  const rings = buildDecisionRings({ decisionCount: 50, paperOrderCount: 2 });
  assert.equal(rings.state, "ORDERING");
  assert.match(rings.detail, /PAPER 주문 2건/);
});

test("invalid counts are treated as unknown, never as zero", () => {
  for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
    const rings = buildDecisionRings({ decisionCount: bad, paperOrderCount: 0 });
    assert.equal(rings.state, "UNKNOWN");
  }
  assert.equal(buildDecisionRings({ decisionCount: 0, paperOrderCount: 0 }).state, "EMPTY");
});
