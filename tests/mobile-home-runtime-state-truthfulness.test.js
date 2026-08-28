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

function fixture(runtimeState) {
  return {
    runtimeState,
    health: "HEALTHY",
    readyForPaperOperations: true,
    disconnected: false,
    readOnlyError: false,
    accountSource: "CLOUD",
    paperEquity: 1_000_000,
    paperTotalPnl: 0,
    aiThesis: null,
    aiEvidenceCount: 0,
    aiCalibrationStatus: null,
    aiConfidence: null,
  };
}

test("a real ERROR runtime state is surfaced as ACTION REQUIRED with an explicit label, not a generic wait state", () => {
  const projection = buildHomeDecisionSurface(fixture("ERROR"));
  assert.equal(projection.attention, "ACTION REQUIRED");
  assert.equal(projection.now, "PAPER RUNTIME ERROR");
  assert.equal(projection.why, "PAPER runtime이 오류를 보고하여 감독자의 확인이 필요합니다.");
  assert.equal(projection.statusLabel, "PAPER · ERROR");
});

test("a real STOPPED/STOPPING runtime state is surfaced as WATCH with an explicit label, never silently blended into QUIET", () => {
  for (const runtimeState of ["STOPPED", "STOPPING"]) {
    const projection = buildHomeDecisionSurface(fixture(runtimeState));
    assert.equal(projection.attention, "WATCH");
    assert.equal(projection.now, "PAPER RUNTIME STOPPED");
    assert.equal(projection.why, "PAPER runtime이 정지되어 있어 새로운 판단이 생성되지 않습니다.");
    assert.equal(projection.statusLabel, "PAPER · STOPPED");
  }
});

test("all 8 real runtime states remain intentionally represented in canonical HOME truth", () => {
  const states = ["HALTED", "READY_OFFLINE", "READY", "RUNNING", "DEGRADED", "ERROR", "STOPPING", "STOPPED"];
  const projected = new Map(states.map((state) => [state, buildHomeDecisionSurface(fixture(state))]));

  assert.equal(projected.get("HALTED").attention, "ACTION REQUIRED");
  assert.equal(projected.get("ERROR").attention, "ACTION REQUIRED");
  assert.equal(projected.get("DEGRADED").attention, "WATCH");
  assert.equal(projected.get("STOPPING").attention, "WATCH");
  assert.equal(projected.get("STOPPED").attention, "WATCH");
  assert.equal(projected.get("RUNNING").now, "PAPER SUPERVISION RUNNING");
  assert.equal(projected.get("READY").now, "PAPER DECISION READY");
  assert.equal(projected.get("READY_OFFLINE").now, "PAPER DECISION READY");
  assert.match(source, /HALTED/);
  assert.match(source, /ERROR/);
  assert.match(source, /DEGRADED/);
  assert.match(source, /STOPPING/);
  assert.match(source, /STOPPED/);
  assert.match(source, /RUNNING/);
});
