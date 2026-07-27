const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeChangeImpact, scanSemantics, detectPolicyRelaxation } = require("../scripts/lib/change-impact-analyzer.js");

function changeSet(files) {
  return {
    schemaVersion: 1, changeId: "CR-SEM", baselineCommitSha: "a", targetCommitSha: "b",
    changeRequest: { changeId: "CR-SEM", title: "t", reason: "r", requestedBy: "u", rollbackPlan: "revert" },
    changedFiles: files
  };
}
const file = (path, addedLines = [], removedLines = []) => ({ path, status: "MODIFIED", addedLines, removedLines });
const findingIds = (files) => scanSemantics(files).map((finding) => finding.id);

test("a private-API order endpoint is detected", () => {
  assert.ok(findingIds([file("apps/desktop/src/a.ts", ['fetch("https://api.upbit.com/v1/orders")'])]).includes("PRIVATE_API_ENDPOINT"));
});

test("a credential-like field is detected", () => {
  assert.ok(findingIds([file("apps/desktop/src/a.ts", ["const secretKey = process.env.SECRET;"])]).includes("CREDENTIAL_FIELD"));
});

test("a live-trading identifier is detected", () => {
  assert.ok(findingIds([file("apps/desktop/src/a.ts", ["function placeOrder() {}"])]).includes("LIVE_TRADING_CAPABILITY"));
});

test("a new IPC handler on an order channel is detected", () => {
  assert.ok(findingIds([file("apps/desktop/src/main.ts", ['ipcMain.handle("paper:order", handler)'])]).includes("NEW_IPC_ORDER_PATH"));
});

test("an SMA parameter assignment is detected on either side of the diff", () => {
  assert.ok(findingIds([file("apps/desktop/src/a.ts", ["shortWindow: 9,"], [])]).includes("STRATEGY_PARAMETER_CHANGE"));
  assert.ok(findingIds([file("apps/desktop/src/a.ts", [], ["longPeriod: 20,"])]).includes("STRATEGY_PARAMETER_CHANGE"));
});

test("a timeframe assignment is detected", () => {
  assert.ok(findingIds([file("apps/desktop/src/a.ts", ["timeframeMs: 300000,"])]).includes("TIMEFRAME_CHANGE"));
});

test("an order-sizing assignment is detected", () => {
  assert.ok(findingIds([file("apps/desktop/src/a.ts", ["orderQuantity: 0.01,"])]).includes("ORDER_SIZING_CHANGE"));
});

test("an accounting formula assignment is detected", () => {
  assert.ok(findingIds([file("apps/desktop/src/a.ts", ["realizedPnl: gross - fee,"])]).includes("ACCOUNTING_FORMULA_CHANGE"));
});

test("a kill-switch edit is detected", () => {
  assert.ok(findingIds([file("apps/desktop/src/a.ts", ["  this.failClosed(name);"])]).includes("KILL_SWITCH_CONDITION_CHANGE"));
});

test("a stale-threshold edit is detected", () => {
  assert.ok(findingIds([file("apps/desktop/src/a.ts", ["staleThreshold: 30000,"])]).includes("STALE_THRESHOLD_CHANGE"));
});

test("an automatic-restart policy edit is detected", () => {
  assert.ok(findingIds([file("apps/desktop/src/a.ts", ["autoTradeEnabled: true,"])]).includes("AUTOMATIC_RESTART_POLICY_CHANGE"));
});

test("an added test skip is detected", () => {
  assert.ok(findingIds([file("tests/a.test.js", ['test.skip("x", () => {})'])]).includes("TEST_SKIP_ADDED"));
});

test("a net removal of assertions is detected, but a refactor that keeps the count is not", () => {
  assert.ok(findingIds([file("tests/a.test.js", [], ["assert.equal(a, b);", "assert.ok(c);"])]).includes("TEST_ASSERTION_REMOVED"));
  assert.ok(!findingIds([file("tests/a.test.js", ["assert.equal(a, b);"], ["assert.equal(b, a);"])]).includes("TEST_ASSERTION_REMOVED"));
});

test("a reduced acceptance minimum is detected as a relaxation", () => {
  const findings = detectPolicyRelaxation(["minimumSessionCount: 5,"], ["minimumSessionCount: 20,"]);
  assert.ok(findings.some((finding) => finding.id === "ACCEPTANCE_MINIMUM_REDUCED"));
});

test("an increased acceptance minimum is not reported as a relaxation", () => {
  const findings = detectPolicyRelaxation(["minimumSessionCount: 40,"], ["minimumSessionCount: 20,"]);
  assert.ok(!findings.some((finding) => finding.id === "ACCEPTANCE_MINIMUM_REDUCED"));
});

test("an increased risk maximum is a relaxation and a decreased one is a tightening", () => {
  const relaxed = detectPolicyRelaxation(["maxOrderNotional: 99,"], ["maxOrderNotional: 10,"]);
  assert.ok(relaxed.some((finding) => finding.id === "RISK_LIMIT_INCREASED"));
  const tightened = detectPolicyRelaxation(["maxOrderNotional: 5,"], ["maxOrderNotional: 10,"]);
  assert.ok(tightened.some((finding) => finding.id === "RISK_LIMIT_TIGHTENED"));
});

test("a semantic finding escalates risk even when the file path looks harmless", () => {
  const result = analyzeChangeImpact(changeSet([file("docs/notes.md", ["const secretKey = 'x';"])]));
  assert.equal(result.riskLevel, "LEVEL_5");
});

test("a semantic finding can never de-escalate a high-risk path", () => {
  const result = analyzeChangeImpact(changeSet([file("apps/desktop/src/paperBroker.ts", ["// harmless comment"])]));
  assert.equal(result.riskLevel, "LEVEL_4");
});

test("a production-behaviour token in a shipping path escalates, but the same token in a test fixture does not", () => {
  const production = analyzeChangeImpact(changeSet([file("apps/desktop/src/strategyEngine.ts", ["shortPeriod = 9,"], ["shortPeriod = 5,"])]));
  assert.equal(production.riskLevel, "LEVEL_4");

  // The identical token inside a test fixture is data, not a production edit. Without
  // this scoping every commit that merely *mentions* a parameter grades LEVEL_4, the
  // gate becomes noise, and a real change stops standing out.
  const fixtureOnly = analyzeChangeImpact(changeSet([file("tests/some.test.js", ["shortWindow: 9,"], ["shortWindow: 5,"])]));
  assert.ok(fixtureOnly.riskLevelNumber < 4);
  assert.ok(!fixtureOnly.categories.includes("STRATEGY_PARAMETER"));
});

test("a research script mentioning an accounting token is not treated as an accounting change", () => {
  const result = analyzeChangeImpact(changeSet([file("scripts/lib/some-runner.js", ["const feeRate = request.feeRate;"])]));
  assert.ok(!result.categories.includes("ACCOUNTING"));
  assert.ok(result.riskLevelNumber < 4);
});

test("security rules stay global: a credential in a test file is still LEVEL_5", () => {
  const result = analyzeChangeImpact(changeSet([file("tests/some.test.js", ["const secretKey = 'abc';"])]));
  assert.equal(result.riskLevel, "LEVEL_5");
  assert.equal(result.changeDecision, "REJECT_CHANGE");
});

test("security rules stay global: a live-order endpoint in a script is still LEVEL_5", () => {
  const result = analyzeChangeImpact(changeSet([file("scripts/tool.js", ['const u = "https://api.upbit.com/v1/orders";'])]));
  assert.equal(result.riskLevel, "LEVEL_5");
});

test("test-hygiene rules stay global: an added skip in a test file is still flagged", () => {
  const result = analyzeChangeImpact(changeSet([file("tests/some.test.js", ['test.skip("x", () => {})'])]));
  assert.ok(result.warnings.some((w) => w.startsWith("TEST_WEAKENING")));
});

test("a repository tooling change is classified as EVIDENCE rather than left UNKNOWN", () => {
  const result = analyzeChangeImpact(changeSet([file("scripts/lib/some-runner.js", ["// tooling"])]));
  assert.ok(result.categories.includes("EVIDENCE"));
  assert.ok(!result.categories.includes("UNKNOWN"));
});
