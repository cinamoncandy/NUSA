const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const src = (f) => fs.readFileSync(path.join(root, "apps/mobile/src", f), "utf8");
const shim = { exports: {} };
new Function("module", "exports", ts.transpileModule(src("haltReasonModel.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(shim, shim.exports);
const { buildHaltExplanation } = shim.exports;

test("a halt explanation exists only while the server status is HALTED", () => {
  for (const status of ["RUNNING", "PAUSED", "ERROR"]) assert.equal(buildHaltExplanation(status, { runtimeHaltReasons: ["KILL_SWITCH_ACTIVE"] }), null);
  assert.ok(buildHaltExplanation("HALTED", null));
});

test("each server halt reason is explained in plain Korean and unknown codes are shown verbatim", () => {
  const e = buildHaltExplanation("HALTED", { runtimeHaltReasons: ["KILL_SWITCH_ACTIVE", "AI_P0_OPEN", "AI_P0_UNVERIFIABLE", "DASHBOARD_FAULTED", "NEW_CODE_X"] });
  assert.deepEqual([...e.lines], [
    "비상 정지 스위치가 켜져 있습니다",
    "AI 중대 경보(P0)가 열려 있습니다",
    "AI 중대 경보(P0) 상태를 확인할 수 없습니다",
    "서버 대시보드가 장애 상태입니다",
    "알 수 없는 정지 코드: NEW_CODE_X",
  ]);
  assert.equal(e.title, "정지 사유");
});

test("the kill switch flag alone is explained, without a duplicate when the reason list also has it", () => {
  assert.deepEqual([...buildHaltExplanation("HALTED", { killSwitchActive: true }).lines], ["비상 정지 스위치가 켜져 있습니다"]);
  assert.equal(buildHaltExplanation("HALTED", { killSwitchActive: true, runtimeHaltReasons: ["KILL_SWITCH_ACTIVE"] }).lines.length, 1);
});

test("a latched server error is shown bounded; per-tick market rejections are not a halt cause", () => {
  const long = "x".repeat(500);
  const e = buildHaltExplanation("HALTED", { lastError: `ORDERBOOK_SNAPSHOT_FAILED ${long}` });
  assert.ok(e.lines[0].startsWith("서버가 기록한 마지막 오류: ORDERBOOK_SNAPSHOT_FAILED"));
  assert.ok(e.lines[0].length < 200);
  const diag = buildHaltExplanation("HALTED", { lastError: "PUBLIC_MARKET_EVENT_REJECTED: stale" });
  assert.match(diag.lines[0], /정지 사유를 보내지 않았습니다/, "diagnostic-only error is not presented as the cause");
});

test("a missing cause is stated as unknown, never guessed; malformed input is ignored", () => {
  for (const evidence of [null, undefined, {}, { runtimeHaltReasons: "KILL_SWITCH_ACTIVE" }, { runtimeHaltReasons: [42, null, "bad code"] }, { lastError: 7 }]) {
    const e = buildHaltExplanation("HALTED", evidence);
    assert.deepEqual([...e.lines], ["서버가 정지 사유를 보내지 않았습니다. 이 앱에서는 원인을 확인할 수 없습니다."]);
  }
  assert.ok(Object.isFrozen(buildHaltExplanation("HALTED", null)));
});

test("the PAPER screen shows it and the app passes the server's own fields", () => {
  assert.match(src("paperLearningMonitorView.tsx"), /state\.halt == null \? null : <StateNotice[\s\S]*paper-learning-halt-reason/);
  assert.match(src("paperLearningScreen.ts"), /halt: buildHaltExplanation\(runtimeStatus, haltEvidence\)/);
  const app = fs.readFileSync(path.join(root, "apps/mobile/App.tsx"), "utf8");
  assert.match(app, /runtimeHaltReasons: snapshot\.operations\.runtimeHaltReasons, killSwitchActive: snapshot\.operations\.killSwitchActive, lastError: snapshot\.operations\.heartbeat\?\.lastError/);
});
