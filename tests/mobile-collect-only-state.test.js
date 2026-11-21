// The server in COLLECT_ONLY mode reports its runtime as STOPPED and the snapshot as DEGRADED (no execution loop, scheduler OFF). The phone used
// to word that healthy, orders-off state as "확인 필요" / "PAPER 상태 확인 필요" / "확인 중". These tests pin the honest wording and, as important,
// that every real fault keeps its warning wording.
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
const { buildHomeFieldInput, isCollectOnlyObservation } = load("homeFieldInput.ts");
const { buildIntelligenceField } = load("intelligenceFieldModel.ts");
const { buildSafetyLine } = load("safetyLineModel.ts");
const { connectionLabel } = load("connectionLabelModel.ts");

const collectOnly = (over = {}, ops = {}) => ({
  health: "DEGRADED",
  readyForPaperOperations: false,
  dashboard: { killSwitchActive: false, overallHealth: "HEALTHY" },
  operations: { runtimeState: "STOPPED", pipelineStage: "READ_ONLY_DASHBOARD", schedulerMode: "OFF", transport: "ONLINE", pendingWrites: 0, heartbeat: { decisionCount: 0, paperOrderCount: 0, lastError: null }, ...ops },
  ...over,
});
const source = (snapshot, over = {}) => ({ snapshot, readOnlyError: null, notConfigured: null, sessionRecovering: false, publicMarketStale: false, ...over });
const field = (snapshot, over) => buildIntelligenceField(buildHomeFieldInput(source(snapshot, over)));

test("the COLLECT_ONLY snapshot reads as collecting with orders off, not as a fault", () => {
  assert.equal(isCollectOnlyObservation(collectOnly()), true);
  const model = field(collectOnly());
  assert.equal(model.phase, "CONNECTED");
  assert.equal(model.headline, "수집 전용\n주문 꺼짐");
  assert.doesNotMatch(`${model.headline} ${model.detail}`, /확인 필요|서버 상태가 정상으로 확인되지/);
  assert.match(model.detail, /주문은 발생하지 않습니다/);
  assert.equal(model.states.paper, "ORDERS OFF");
});

test("every other fact keeps the warning wording: only the exact COLLECT_ONLY combination is relabelled", () => {
  const faults = [
    collectOnly({ health: "FAIL_CLOSED" }),
    collectOnly({ health: "HEALTHY" }),
    collectOnly({ dashboard: { killSwitchActive: true, overallHealth: "HEALTHY" } }),
    collectOnly({ dashboard: { killSwitchActive: false, overallHealth: "DEGRADED" } }),
    collectOnly({ dashboard: { killSwitchActive: false, overallHealth: "DOWN" } }),
    collectOnly({ dashboard: { killSwitchActive: false } }),
    collectOnly({}, { runtimeState: "RUNNING" }),
    collectOnly({}, { runtimeState: "DEGRADED" }),
    collectOnly({}, { runtimeState: "HALTED" }),
    collectOnly({}, { pipelineStage: "PAPER_EXECUTION_LOOP" }),
    collectOnly({}, { pipelineStage: undefined }),
    collectOnly({}, { schedulerMode: "ACTIVE" }),
    collectOnly({}, { schedulerMode: undefined }),
    collectOnly({}, { transport: "OFFLINE" }),
    collectOnly({}, { transport: undefined }),
    collectOnly({}, { pendingWrites: 1 }),
    collectOnly({}, { pendingWrites: undefined }),
    null, undefined,
  ];
  for (const snapshot of faults) assert.equal(isCollectOnlyObservation(snapshot), false, JSON.stringify(snapshot)?.slice(0, 120));
  assert.equal(field(collectOnly({}, { transport: "OFFLINE" })).headline, "PAPER 상태 확인 필요", "a lost transport is still a warning");
  assert.equal(field(collectOnly({}, { pendingWrites: 3 })).headline, "PAPER 상태 확인 필요");
  assert.equal(field(collectOnly({ dashboard: { killSwitchActive: false, overallHealth: "DEGRADED" } })).headline, "PAPER 상태 확인 필요", "a degraded dashboard is never relabelled");
  assert.equal(field(collectOnly({ dashboard: { killSwitchActive: true, overallHealth: "HEALTHY" } })).phase, "HALTED", "a halt still wins");
  assert.equal(field(collectOnly({}, { runtimeState: "HALTED" })).phase, "HALTED");
  assert.equal(field(collectOnly(), { readOnlyError: "boom" }).headline, "PAPER 상태 확인 필요", "a failed read is never relabelled");
  assert.equal(field(collectOnly(), { notConfigured: "x" }).phase, "AUTHENTICATION");
});

test("the safety line says 수집 전용 and still shows the PAPER/LIVE boundary; a halt or a missing session is never softened", () => {
  const line = buildSafetyLine({ sessionState: "VERIFIED", runtimeHalted: false, dataUnconfirmed: true, collectOnly: true });
  assert.deepEqual({ ...line }, { tone: "ok", word: "수집 전용", detail: "주문 꺼짐 · PAPER 전용 · LIVE 잠김" });
  assert.equal(buildSafetyLine({ sessionState: "VERIFIED", runtimeHalted: false, dataUnconfirmed: true }).word, "확인 필요", "without the flag the old wording stays");
  assert.equal(buildSafetyLine({ sessionState: "VERIFIED", runtimeHalted: true, dataUnconfirmed: true, collectOnly: true }).word, "정지됨");
  assert.equal(buildSafetyLine({ sessionState: "RECOVERING", runtimeHalted: false, dataUnconfirmed: true, collectOnly: true }).word, "재연결 중");
  assert.equal(buildSafetyLine({ sessionState: "RECOVERY_REQUIRED", runtimeHalted: false, collectOnly: true }).word, "연결 필요");
  assert.equal(buildSafetyLine({ sessionState: "NOT_CONFIGURED", runtimeHalted: false, collectOnly: true }).word, "서버 미설정");
  assert.equal(buildSafetyLine({ sessionState: "VERIFIED", runtimeHalted: false }).word, "안전", "a healthy session is unchanged");
});

test("the status capsule reads 수집 전용 only when nothing worse applies", () => {
  const base = { recovering: false, stale: false, disconnected: false, readOnlyError: false, readyForPaperOperations: false };
  assert.equal(connectionLabel({ ...base, collectOnly: true }), "수집 전용");
  assert.equal(connectionLabel(base), "확인 중", "unchanged without the flag");
  assert.equal(connectionLabel({ ...base, collectOnly: true, readOnlyError: true }), "연결 불안정");
  assert.equal(connectionLabel({ ...base, collectOnly: true, stale: true }), "이전 값");
  assert.equal(connectionLabel({ ...base, collectOnly: true, disconnected: true }), "연결 필요");
  assert.equal(connectionLabel({ ...base, collectOnly: true, recovering: true }), "재연결 중");
  assert.equal(connectionLabel({ ...base, collectOnly: true, readyForPaperOperations: true }), "작동 중");
});

test("source pins: the screens pass the flag from the one helper, and no order, authority or limit code is touched", () => {
  const app = fs.readFileSync(path.join(root, "apps/mobile/App.tsx"), "utf8");
  assert.match(app, /collectOnly: !paperProjectionPending && isCollectOnlyObservation\(snapshot\)/);
  const home = fs.readFileSync(path.join(root, "apps/mobile/src/homeView.tsx"), "utf8");
  assert.match(home, /collectOnly: fieldInput\.collectOnly === true/);
  const helper = fs.readFileSync(path.join(root, "apps/mobile/src/homeFieldInput.ts"), "utf8");
  const body = helper.slice(helper.indexOf("export function isCollectOnlyObservation"), helper.indexOf("export interface HomeFieldSource"));
  assert.ok(body.length > 200, "the helper body was found");
  assert.doesNotMatch(body, /\b(fetch|XMLHttpRequest|submit|placeOrder|authority)\b/, "a pure read of snapshot fields");
});
