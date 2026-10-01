const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "apps/mobile/src/liveGateModel.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: sourcePath }).outputText;
const moduleShim = { exports: {} };
new Function("module", "exports", "require", compiled)(moduleShim, moduleShim.exports, require);
const { buildLiveGates } = moduleShim.exports;

const safe = { killSwitchActive: false, staleMarketData: false, reconciliationMismatch: false, exchangeError: false, abnormalBalanceDrift: false, riskBudgetBreached: false, strategyInvalidated: false, latencyOrSlippageBreached: false };
const ready = { status: "READY_FOR_MANUAL_ENABLE", blockers: [], paperAutoLearning: "STABLE", shadowReplay: "VALID", realAccountMonitor: "CONNECTED", credentialReadiness: "READY", governance: "APPROVED", tradePermission: "PERMIT", riskAuthority: "HEALTHY", reconciliationTests: "PASS", killSwitchTests: "PASS", idempotencyTests: "PASS", exchangeFaultTests: "PASS", prohibitedFinancialMutationScan: "ABSENT", runtimeSafety: safe };

test("live gate model is import-free", () => { assert.doesNotMatch(source, /^import /m); });

test("no snapshot yields no gates instead of invented ones", () => { assert.equal(buildLiveGates(null), null); });

test("all gates passing still reads as awaiting owner approval, never enabled", () => {
  const model = buildLiveGates(ready);
  assert.equal(model.passed, model.total);
  assert.match(model.headline, /소유자 승인 대기/);
  assert.match(model.detail, /앱에서는 LIVE를 켤 수 없습니다/);
});

test("unknown evidence is UNKNOWN, a contrary value is BLOCKED", () => {
  const model = buildLiveGates({ ...ready, status: "NOT_READY", governance: "UNKNOWN", tradePermission: "REJECT", blockers: ["x"] });
  const byId = Object.fromEntries(model.gates.map((g) => [g.id, g.state]));
  assert.equal(byId.governance, "UNKNOWN");
  assert.equal(byId.permission, "BLOCKED");
  assert.equal(model.headline, "LIVE는 잠겨 있습니다");
  assert.match(model.detail, /관문 10개 중 8개 통과/);
});

test("any runtime safety flag halts and blocks the runtime gate", () => {
  const model = buildLiveGates({ ...ready, runtimeSafety: { ...safe, staleMarketData: true } });
  assert.equal(model.gates.find((g) => g.id === "runtime").state, "BLOCKED");
  assert.match(model.headline, /안전 정지/);
});

test("drills pass only when all four pass; one failure blocks, all unknown is unknown", () => {
  const g = (patch) => buildLiveGates({ ...ready, ...patch }).gates.find((x) => x.id === "drills").state;
  assert.equal(g({}), "PASS");
  assert.equal(g({ killSwitchTests: "FAIL" }), "BLOCKED");
  assert.equal(g({ reconciliationTests: "UNKNOWN", killSwitchTests: "UNKNOWN", idempotencyTests: "UNKNOWN", exchangeFaultTests: "UNKNOWN" }), "UNKNOWN");
});

test("missing shadow replay evidence is unknown, not blocked", () => {
  assert.equal(buildLiveGates({ ...ready, shadowReplay: "MISSING" }).gates.find((x) => x.id === "shadow").state, "UNKNOWN");
  assert.equal(buildLiveGates({ ...ready, shadowReplay: "INVALID" }).gates.find((x) => x.id === "shadow").state, "BLOCKED");
});
