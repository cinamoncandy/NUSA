const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "apps/mobile/src/homeDecisionSurface.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
}).outputText;
const moduleShim = { exports: {} };
new Function("module", "exports", "require", compiled)(moduleShim, moduleShim.exports, require);
const { buildHomeDecisionSurface } = moduleShim.exports;

function fixture(overrides = {}) {
  return {
    runtimeState: "RUNNING",
    health: "HEALTHY",
    readyForPaperOperations: true,
    disconnected: false,
    readOnlyError: false,
    accountSource: "CLOUD",
    paperEquity: 1_050_000,
    paperTotalPnl: 50_000,
    aiThesis: "Verified PAPER thesis",
    aiEvidenceCount: 3,
    aiCalibrationStatus: "CALIBRATED",
    aiConfidence: 0.62,
    ...overrides,
  };
}

test("healthy PAPER resolves one ordered evidence-first projection", () => {
  const projection = buildHomeDecisionSurface(fixture());
  assert.equal(projection.attention, "QUIET");
  assert.equal(projection.now, "PAPER SUPERVISION RUNNING");
  assert.equal(projection.why, "Verified PAPER thesis");
  assert.match(projection.result, /^PAPER P&L \+₩50,000 · EQUITY ₩1,050,000$/);
  assert.equal(projection.risk, "PAPER ONLY · SAFETY GATES READY · LIVE NONE");
  assert.match(projection.learning, /근거 3개 · 62%/);
  assert.equal(projection.primaryAction, "AI_SIGNAL");
});

test("current offline evidence outranks a prior positive decision", () => {
  const projection = buildHomeDecisionSurface(fixture({
    disconnected: true,
    runtimeState: "RUNNING",
    aiThesis: "Prior positive thesis",
  }));
  assert.equal(projection.attention, "ACTION REQUIRED");
  assert.equal(projection.now, "PAPER LINK REQUIRED");
  assert.doesNotMatch(projection.why, /Prior positive thesis/);
  assert.equal(projection.risk, "BLOCKED · PAPER LINK REQUIRED");
  assert.equal(projection.primaryAction, "SETTINGS");
});

test("ERROR and HALTED remain fail-closed even with verified AI evidence", () => {
  for (const runtimeState of ["ERROR", "HALTED"]) {
    const projection = buildHomeDecisionSurface(fixture({ runtimeState }));
    assert.equal(projection.attention, "ACTION REQUIRED");
    assert.match(projection.now, new RegExp(runtimeState));
    assert.equal(projection.risk, "BLOCKED · PAPER RUNTIME REQUIRES ACTION");
    assert.equal(projection.primaryAction, "PORTFOLIO");
  }
});

test("insufficient evidence stays explicit and never invents confidence", () => {
  const projection = buildHomeDecisionSurface(fixture({
    aiThesis: null,
    aiEvidenceCount: 0,
    aiCalibrationStatus: "CALIBRATED",
    aiConfidence: 0.99,
  }));
  assert.equal(projection.aiInsightAvailable, false);
  assert.equal(projection.calibratedConfidence, undefined);
  assert.match(projection.learning, /검증 근거가 없으므로/);
  assert.equal(projection.primaryAction, "MARKETS");
});

test("READ_ONLY recovery failure outranks prior healthy runtime and PAPER result", () => {
  const projection = buildHomeDecisionSurface(fixture({ readOnlyError: true }));
  assert.equal(projection.attention, "ACTION REQUIRED");
  assert.equal(projection.now, "RECOVERY REQUIRED");
  assert.equal(projection.risk, "BLOCKED · READ-ONLY RECOVERY REQUIRED");
  assert.equal(projection.primaryAction, "SETTINGS");
});

test("LOCAL PAPER provenance does not claim cloud runtime evidence", () => {
  const projection = buildHomeDecisionSurface(fixture({
    accountSource: "LOCAL",
    runtimeState: undefined,
    health: undefined,
    readyForPaperOperations: false,
  }));
  assert.equal(projection.statusLabel, "PAPER · LOCAL");
  assert.equal(projection.statusTone, "info");
  assert.equal(projection.risk, "INSUFFICIENT · PAPER RUNTIME EVIDENCE UNAVAILABLE");
});

test("projection preserves authority invariants and contains no execution semantics", () => {
  assert.match(source, /LIVE NONE/);
  assert.doesNotMatch(source, /placeOrder|cancelOrder|withdraw|transfer|productionMutationAllowed\s*=\s*true/);
});
