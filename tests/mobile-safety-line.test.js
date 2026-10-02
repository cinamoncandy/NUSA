const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "apps/mobile/src/safetyLineModel.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const shim = { exports: {} };
new Function("module", "exports", "require", compiled)(shim, shim.exports, require);
const { buildSafetyLine } = shim.exports;

test("only a verified session with a running runtime reads 안전", () => {
  assert.deepEqual({ ...buildSafetyLine({ sessionState: "VERIFIED", runtimeHalted: false }) }, { tone: "ok", word: "안전", detail: "PAPER 전용 · LIVE 잠김" });
  assert.equal(buildSafetyLine({ sessionState: "VERIFIED", runtimeHalted: true }).word, "정지됨");
  assert.equal(buildSafetyLine({ sessionState: "RECOVERING", runtimeHalted: false }).tone, "wait");
  assert.equal(buildSafetyLine({ sessionState: "RECOVERY_REQUIRED", runtimeHalted: false }).word, "연결 필요");
  assert.equal(buildSafetyLine({ sessionState: "NOT_CONFIGURED", runtimeHalted: false }).word, "서버 미설정");
  for (const state of ["VERIFIED", "RECOVERING", "RECOVERY_REQUIRED", "NOT_CONFIGURED"]) {
    assert.match(buildSafetyLine({ sessionState: state, runtimeHalted: false }).detail, /LIVE 잠김/);
  }
});

test("every tab shows the safety line and LIVE lists remaining gates before passed ones", () => {
  const app = fs.readFileSync(path.join(root, "apps/mobile/App.tsx"), "utf8").replace(/\r\n/g, "\n");
  assert.match(app, /<SafetyLine line=\{buildSafetyLine\(\{ sessionState: shownSessionState, runtimeHalted: snapshot\?\.paperLearning\?\.runtimeStatus === "HALTED" \}\)\} \/>\n    <TabTransition/);
  const live = fs.readFileSync(path.join(root, "apps/mobile/src/liveReadinessMonitorView.tsx"), "utf8");
  assert.match(live, /sort\(\(left, right\) => Number\(left\.state === "PASS"\) - Number\(right\.state === "PASS"\)\)/);
  assert.match(live, /`남은 조건 \$\{gates\.total - gates\.passed\}개`/);
});
