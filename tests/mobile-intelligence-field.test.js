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

const base = { checking: false, disconnected: false, recovering: false, haltActive: false, degraded: false, feedStale: false, readyForPaperOperations: true, decisionCount: 10, paperOrderCount: 3 };
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

test("unavailable or unhealthy PAPER state fails closed instead of reading CONNECTED", () => {
  const model = field({ degraded: true, feedStale: true });
  assert.equal(model.phase, "DEGRADED");
  assert.equal(model.tone, "amber");
  assert.equal(field({ degraded: true, haltActive: true }).phase, "HALTED");
  const home = fs.readFileSync(path.join(root, "apps/mobile/src/homeView.tsx"), "utf8");
  // Behaviour of the mapping is covered in tests/mobile-home-field-input.test.js.
  assert.match(home, /input=\{buildHomeFieldInput\(/);
});

test("a stale phone quote feed is described as local display lag, not a server decision pause", () => {
  const model = field({ feedStale: true });
  assert.equal(model.states.market, "QUOTE STALE");
  assert.match(model.detail, /서버 판단과는 별개/);
  assert.doesNotMatch(model.detail, /보류/);
});

test("decisions without paper orders use neutral no-execution wording, never an invented cause", () => {
  const model = field({ decisionCount: 533435, paperOrderCount: 0 });
  assert.equal(model.phase, "ATTENTION");
  assert.equal(model.focus, "paper");
  assert.equal(model.states.paper, "NO ORDERS");
  assert.ok(!JSON.stringify(model).includes("NO STRATEGY"));
  const withFacts = field({ decisionCount: 5, paperOrderCount: 0, pipelineStage: "RISK_GATE", lastError: "policy approval disabled" });
  assert.match(withFacts.detail, /현재 단계: RISK_GATE/);
  assert.match(withFacts.detail, /마지막 기록 오류: policy approval disabled/);
  assert.equal(withFacts.tone, "green", "a latched historical error must not read as an active warning");
  const malformed = field({ decisionCount: 5, paperOrderCount: 0, pipelineStage: 42, lastError: { bad: true } });
  assert.doesNotMatch(malformed.detail, /현재 단계|마지막 기록 오류/);
  assert.equal(field({ decisionCount: 5, paperOrderCount: 0, pipelineStage: "OBSERVE" }).tone, "green");
  assert.equal(field({ decisionCount: null, paperOrderCount: null }).phase, "CONNECTED");
  assert.equal(field({ readyForPaperOperations: false }).states.paper, "OBSERVING");
});

test("field model is frozen and HOME wires only real state", () => {
  const model = field({});
  assert.ok(Object.isFrozen(model) && Object.isFrozen(model.lit) && Object.isFrozen(model.states));
  const home = fs.readFileSync(path.join(root, "apps/mobile/src/homeView.tsx"), "utf8");
  assert.match(home, /<IntelligenceField input=\{buildHomeFieldInput\(/);
  const view = fs.readFileSync(path.join(root, "apps/mobile/src/intelligenceField.tsx"), "utf8");
  assert.match(view, /isReduceMotionEnabled/);
  assert.match(view, /useState<boolean \| null>\(null\)/);
  assert.match(view, /reducedMotion !== false/);
  assert.match(view, /const ParticleLayer = memo\(/);
  assert.doesNotMatch(view, /Animated\.loop/);
});

test("state changes propagate as signals along strands, inward for problems, never on mount", () => {
  const view = fs.readFileSync(path.join(root, "apps/mobile/src/intelligenceField.tsx"), "utf8");
  assert.match(view, /export function buildStrandPaths/);
  assert.match(view, /function Signal\(/);
  assert.match(view, /setInward\(model\.tone === "amber" \|\| model\.tone === "red"\)/);
  assert.match(view, /if \(reducedMotion !== false \|\| !changed\)/);
  assert.match(view, /Animated\.stagger\(fieldMotion\.signalStaggerMs/);
  assert.doesNotMatch(view, /Animated\.loop/);
  assert.doesNotMatch(view, /useNativeDriver: false/);
});
