const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { ShadowPilotRuntime, verifyShadowPilotEvents } = require("../dist/apps/desktop/src/shadow/shadowPilotRuntime.js");

const CLI = path.resolve(__dirname, "..", "scripts", "run-shadow-paper-pilot.js");

function buildSession() {
  const pilot = new ShadowPilotRuntime({
    sessionId: "verification-test",
    createdAt: 0,
    sourceCommitSha: "abc123",
    symbol: "KRW-BTC",
    strategyId: "sma-crossover",
    fingerprints: { strategy: "a", config: "b", runtime: "c", riskPolicy: "d" }
  });
  pilot.precheck({ paperOnly: true, deploymentIntegrity: true, reconciliation: true, killSwitch: false, openP0: false, marketDataHealthy: true, warmedUp: true, automaticTrading: false });
  pilot.start(0);
  pilot.observe({ timestamp: 1, signalId: "s1", commandId: "c1", side: "BUY", quantity: 1, decision: "ALLOW", reasonCodes: [] });
  pilot.stop(2);
  return pilot;
}

test("a shadow run that mutated real broker state is reported as SHADOW_MUTATION", () => {
  const log = [...buildSession().eventLog()];
  assert.deepEqual(verifyShadowPilotEvents(log, "abc123"), [], "an untouched chain must verify clean");

  // The whole purpose of shadow mode is proving no real order, fill, cash, or position moved.
  const leaked = [...log];
  leaked[1] = { ...leaked[1], actualOrderDelta: 1 };
  const errors = verifyShadowPilotEvents(leaked, "abc123");
  assert.ok(errors.includes("SHADOW_MUTATION"), `expected SHADOW_MUTATION, got ${errors.join(", ")}`);
});

test("an out-of-order or re-signed event chain is reported rather than accepted", () => {
  const log = [...buildSession().eventLog()];
  const reordered = [log[1], log[0], log[2]];
  assert.ok(verifyShadowPilotEvents(reordered, "abc123").length > 0, "reordering must not verify clean");

  const missingCommit = verifyShadowPilotEvents(log, "");
  assert.ok(missingCommit.includes("SOURCE_COMMIT_MISSING"));
});

test("the shadow pilot CLI reports verification errors and exits 0 only when there are none", () => {
  const stdout = execFileSync(process.execPath, [CLI, "--dry-run"], { encoding: "utf8" });
  const summary = JSON.parse(stdout);
  // Regression: the CLI computed `verification` and then neither printed nor acted on it, so a
  // violating run produced a clean-looking summary and a success exit code.
  assert.ok("verificationErrors" in summary, "the CLI summary must surface the verification result");
  assert.deepEqual(summary.verificationErrors, []);
  assert.equal(summary.actualOrderCount, 0);
  assert.equal(summary.actualFillCount, 0);
});
