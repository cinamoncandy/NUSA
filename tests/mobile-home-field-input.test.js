// Behavioural contract for the HOME field screen model. Tests like this one survive a full HOME
// redesign because they exercise the pure mapping, not the presenter's source text.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const load = (file) => {
  const full = path.join(root, "apps/mobile/src", file);
  const out = ts.transpileModule(fs.readFileSync(full, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: full }).outputText;
  const shim = { exports: {} };
  new Function("module", "exports", "require", out)(shim, shim.exports, require);
  return shim.exports;
};
const { buildHomeFieldInput } = load("homeFieldInput.ts");
const { buildIntelligenceField } = load("intelligenceFieldModel.ts");

const snapshot = (overrides = {}) => ({
  health: "HEALTHY",
  readyForPaperOperations: true,
  dashboard: { killSwitchActive: false },
  operations: { runtimeState: "RUNNING", pipelineStage: "OBSERVE", heartbeat: { decisionCount: 10, paperOrderCount: 2, lastError: null } },
  ...overrides,
});
const source = (overrides = {}) => ({ snapshot: snapshot(), readOnlyError: null, notConfigured: null, sessionRecovering: false, publicMarketStale: false, ...overrides });
const phase = (overrides) => buildIntelligenceField(buildHomeFieldInput(source(overrides))).phase;

test("connection and read failures reach the field before any healthy reading", () => {
  assert.equal(phase({ snapshot: null }), "LAUNCH");
  assert.equal(phase({ snapshot: null, notConfigured: "setup" }), "AUTHENTICATION");
  assert.equal(phase({ snapshot: null, notConfigured: "setup", sessionRecovering: true }), "RECOVERING");
  assert.equal(phase({ snapshot: null, readOnlyError: "503" }), "DEGRADED");
  assert.equal(phase({ snapshot: snapshot({ health: "DEGRADED" }) }), "DEGRADED");
  assert.equal(phase({ snapshot: snapshot({ operations: { runtimeState: "ERROR" } }) }), "DEGRADED");
  assert.equal(phase({}), "CONNECTED");
});

test("kill switch or HALTED runtime maps to HALTED", () => {
  assert.equal(phase({ snapshot: snapshot({ dashboard: { killSwitchActive: true } }) }), "HALTED");
  assert.equal(phase({ snapshot: snapshot({ operations: { runtimeState: "HALTED" } }) }), "HALTED");
});

test("canonical counters and untrusted runtime strings are forwarded safely", () => {
  const input = buildHomeFieldInput(source({ snapshot: snapshot({ operations: { runtimeState: "RUNNING", pipelineStage: 7, heartbeat: { decisionCount: 5, paperOrderCount: 0, lastError: { x: 1 } } } }) }));
  assert.equal(input.decisionCount, 5);
  assert.equal(input.paperOrderCount, 0);
  assert.equal(input.pipelineStage, null);
  assert.equal(input.lastError, null);
  assert.ok(Object.isFrozen(input));
});

test("the phone quote feed only marks market staleness", () => {
  assert.equal(buildHomeFieldInput(source({ publicMarketStale: true })).feedStale, true);
  assert.equal(phase({ publicMarketStale: true }), "ATTENTION");
});
