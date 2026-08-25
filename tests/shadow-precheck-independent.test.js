const test = require("node:test");
const assert = require("node:assert/strict");
const { ShadowPilotRuntime } = require("../dist/apps/desktop/src/shadow/shadowPilotRuntime.js");

const READY_INPUT = Object.freeze({
  paperOnly: true, deploymentIntegrity: true, reconciliation: true, killSwitch: false,
  openP0: false, marketDataHealthy: true, warmedUp: true, automaticTrading: false
});

function precheckWith(overrides) {
  const pilot = new ShadowPilotRuntime({
    sessionId: "precheck-test",
    createdAt: 0,
    sourceCommitSha: "abc123",
    symbol: "KRW-BTC",
    strategyId: "sma-crossover",
    fingerprints: { strategy: "a", config: "b", runtime: "c", riskPolicy: "d" }
  });
  return { status: pilot.precheck({ ...READY_INPUT, ...overrides }), pilot };
}

test("the shadow pilot precheck reports READY only when every condition holds", () => {
  assert.equal(precheckWith({}).status, "READY");
});

test("each safety condition the shadow runtime forwards can actually block the precheck", () => {
  // Regression: shadowOperationalRuntime called this precheck with literals, describing it in a
  // comment as a "second, independent confirmation". A gate handed constants cannot confirm
  // anything -- it can only agree. These assertions are what make forwarding live state
  // meaningful: if any of them stopped blocking, the second gate would silently become a no-op
  // again even with the wiring in place.
  const blocking = [
    { deploymentIntegrity: false },
    { reconciliation: false },
    { killSwitch: true },
    { openP0: true },
    { marketDataHealthy: false },
    { warmedUp: false },
    { automaticTrading: true }
  ];
  for (const override of blocking) {
    const [field] = Object.keys(override);
    const { status } = precheckWith(override);
    assert.notEqual(status, "READY", `${field}=${override[field]} must prevent READY`);
  }
});

test("a blocked precheck records why rather than failing silently", () => {
  const { pilot } = precheckWith({ killSwitch: true });
  const blockers = pilot.snapshot().blockers;
  assert.ok(blockers.length > 0, "a blocked precheck must expose at least one blocker");
});
