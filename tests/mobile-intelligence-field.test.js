const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "apps/mobile/src/intelligenceFieldModel.ts");
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
}).outputText;
const moduleShim = { exports: {} };
new Function("module", "exports", "require", compiled)(moduleShim, moduleShim.exports, require);
const { buildIntelligenceField } = moduleShim.exports;

const base = { checking: false, disconnected: false, recovering: false, haltActive: false, feedStale: false, readyForPaperOperations: true, decisionCount: 10, paperOrderCount: 3 };
const field = (overrides) => buildIntelligenceField({ ...base, ...overrides });

test("intelligence field phases follow fail-closed priority", () => {
  assert.equal(field({ checking: true }).phase, "LAUNCH");
  assert.equal(field({ disconnected: true, recovering: true, haltActive: true }).phase, "RECOVERING");
  assert.equal(field({ disconnected: true }).focus, "governance");
  const halted = field({ haltActive: true, feedStale: true });
  assert.equal(halted.phase, "HALTED");
  assert.equal(halted.tone, "red");
  assert.equal(halted.focus, "risk");
  assert.equal(field({ feedStale: true }).focus, "market");
  assert.equal(field({}).phase, "CONNECTED");
});

test("decisions without paper orders are surfaced as AXIOM attention, never invented activity", () => {
  const model = field({ decisionCount: 533435, paperOrderCount: 0 });
  assert.equal(model.phase, "ATTENTION");
  assert.equal(model.focus, "axiom");
  assert.equal(model.states.axiom, "NO STRATEGY");
  assert.equal(field({ decisionCount: null, paperOrderCount: null }).phase, "CONNECTED");
  assert.equal(field({ readyForPaperOperations: false }).states.paper, "OBSERVING");
});

test("field model is frozen and HOME wires only real state", () => {
  const model = field({});
  assert.ok(Object.isFrozen(model) && Object.isFrozen(model.lit) && Object.isFrozen(model.states));
  const home = fs.readFileSync(path.join(root, "apps/mobile/src/homeView.tsx"), "utf8");
  assert.match(home, /<IntelligenceField input=/);
  assert.match(home, /operations\.heartbeat\?\.decisionCount/);
  const view = fs.readFileSync(path.join(root, "apps/mobile/src/intelligenceField.tsx"), "utf8");
  assert.match(view, /isReduceMotionEnabled/);
  assert.doesNotMatch(view, /Animated\.loop/);
});
