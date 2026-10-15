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
const SOURCES = ["paperAutoLearning", "shadowReplay", "realAccountMonitor", "governance", "tradePermission", "riskAuthority", "reconciliationTests", "killSwitchTests", "idempotencyTests", "exchangeFaultTests", "prohibitedFinancialMutationScan", "runtimeSafety"];
const allFresh = Object.fromEntries(SOURCES.map((s) => [s, "FRESH"]));
const ready = { status: "READY_FOR_MANUAL_ENABLE", blockers: [], paperAutoLearning: "STABLE", shadowReplay: "VALID", realAccountMonitor: "CONNECTED", credentialReadiness: "READY", governance: "APPROVED", tradePermission: "PERMIT", riskAuthority: "HEALTHY", reconciliationTests: "PASS", killSwitchTests: "PASS", idempotencyTests: "PASS", exchangeFaultTests: "PASS", prohibitedFinancialMutationScan: "ABSENT", runtimeSafety: safe, freshness: allFresh };

test("live gate model is import-free", () => { assert.doesNotMatch(source, /^import /m); });

test("no snapshot yields no gates instead of invented ones", () => { assert.equal(buildLiveGates(null), null); });

test("all gates passing still reads as awaiting owner approval, never enabled", () => {
  const model = buildLiveGates(ready);
  assert.equal(model.passed, model.total);
  assert.match(model.headline, /소유자 LIVE 활성화 승인 대기/);
  assert.match(model.detail, /앱에서는 LIVE를 켤 수 없습니다/);
});

test("unknown evidence is CHECKING, an explicit negative result is FAIL", () => {
  const model = buildLiveGates({ ...ready, status: "NOT_READY", governance: "UNKNOWN", tradePermission: "REJECT", blockers: ["x"] });
  const byId = Object.fromEntries(model.gates.map((g) => [g.id, g.state]));
  assert.equal(byId.governance, "CHECKING");
  assert.equal(byId.permission, "FAIL");
  assert.equal(model.headline, "LIVE는 잠겨 있습니다");
  assert.match(model.detail, /관문 11개 중 8개 통과/);
});

test("any runtime safety flag halts and blocks the runtime gate", () => {
  const model = buildLiveGates({ ...ready, runtimeSafety: { ...safe, staleMarketData: true } });
  assert.equal(model.gates.find((g) => g.id === "runtime").state, "FAIL");
  assert.match(model.headline, /안전 정지/);
});

test("drills pass only when all four pass; one failure blocks, all unknown is unknown", () => {
  const g = (patch) => buildLiveGates({ ...ready, ...patch }).gates.find((x) => x.id === "drills").state;
  assert.equal(g({}), "PASS");
  assert.equal(g({ killSwitchTests: "FAIL" }), "FAIL");
  assert.equal(g({ reconciliationTests: "UNKNOWN", killSwitchTests: "UNKNOWN", idempotencyTests: "UNKNOWN", exchangeFaultTests: "UNKNOWN" }), "CHECKING");
});

test("missing shadow replay evidence is BLOCKED, invalid evidence is FAIL", () => {
  assert.equal(buildLiveGates({ ...ready, shadowReplay: "MISSING" }).gates.find((x) => x.id === "shadow").state, "BLOCKED");
  assert.equal(buildLiveGates({ ...ready, shadowReplay: "INVALID" }).gates.find((x) => x.id === "shadow").state, "FAIL");
});

test("canonical blockers keep the evaluator gate closed even when every raw field passes", () => {
  const model = buildLiveGates({ ...ready, status: "NOT_READY", blockers: ["REQUIRED_CI_NOT_GREEN"] });
  assert.equal(model.gates.find((g) => g.id === "evaluator").state, "BLOCKED");
  assert.notEqual(model.passed, model.total);
  assert.equal(model.headline, "LIVE는 잠겨 있습니다");
});

test("runtime safety only passes when its source is fresh", () => {
  assert.equal(buildLiveGates({ ...ready, freshness: { ...allFresh, runtimeSafety: "UNKNOWN" } }).gates.find((g) => g.id === "runtime").state, "CHECKING");
  assert.equal(buildLiveGates({ ...ready, freshness: { ...allFresh, runtimeSafety: "STALE" } }).gates.find((g) => g.id === "runtime").state, "STALE");
});

test("strategy governance approval is not presented as owner LIVE activation", () => {
  const model = buildLiveGates(ready);
  const governance = model.gates.find((g) => g.id === "governance");
  assert.equal(governance.title, "전략 거버넌스 승인");
  assert.match(governance.detail, /LIVE 활성화 승인과는 별개/);
  assert.match(model.headline, /소유자 LIVE 활성화 승인 대기/);
});

test("a passing value on stale or missing evidence is never PASS, for every one of the nine safety items", () => {
  const ids = { shadowReplay: "shadow", realAccountMonitor: "account", governance: "governance", tradePermission: "permission", riskAuthority: "risk", reconciliationTests: "drills", prohibitedFinancialMutationScan: "mutation", runtimeSafety: "runtime" };
  for (const [source, id] of Object.entries(ids)) {
    const stale = buildLiveGates({ ...ready, freshness: { ...allFresh, [source]: "STALE" } });
    assert.equal(stale.gates.find((g) => g.id === id).state, "STALE", `${id} stale`);
    const missing = { ...allFresh }; delete missing[source];
    assert.equal(buildLiveGates({ ...ready, freshness: missing }).gates.find((g) => g.id === id).state, "CHECKING", `${id} missing`);
    assert.notEqual(stale.passed, stale.total);
  }
  // The credential item follows the account monitor's freshness.
  assert.equal(buildLiveGates({ ...ready, freshness: { ...allFresh, realAccountMonitor: "STALE" } }).gates.find((g) => g.id === "credential").state, "STALE");
});

test("explicit negative results stay FAIL even when their evidence is old", () => {
  const model = buildLiveGates({ ...ready, riskAuthority: "HALTED", prohibitedFinancialMutationScan: "PRESENT", freshness: { ...allFresh, riskAuthority: "STALE", prohibitedFinancialMutationScan: "UNKNOWN" } });
  const byId = Object.fromEntries(model.gates.map((g) => [g.id, g.state]));
  assert.equal(byId.risk, "FAIL");
  assert.equal(byId.mutation, "FAIL");
});

test("account monitor states: STALE is old evidence, connection errors are FAIL, no credential is BLOCKED", () => {
  const state = (patch) => Object.fromEntries(buildLiveGates({ ...ready, ...patch }).gates.map((g) => [g.id, g.state]));
  assert.equal(state({ realAccountMonitor: "STALE" }).account, "STALE");
  for (const value of ["AUTH_ERROR", "RELAY_ERROR", "OFFLINE"]) assert.equal(state({ realAccountMonitor: value }).account, "FAIL");
  assert.equal(state({ credentialReadiness: "NOT_READY" }).credential, "BLOCKED");
  assert.equal(state({ realAccountMonitor: "UNKNOWN" }).account, "CHECKING");
});
