const test = require("node:test");
const assert = require("node:assert/strict");
const { runPaperFaultDrill } = require("../dist/apps/cloud/src/paperFaultDrill.js");

const hooks = () => {
  let state = { runtime: { cash: 1000 }, persistedOrderIds: [], persistedSignalKeys: [], strategyStatus: "RUNNING", autoTradeEnabled: true, controlState: "RUNNING" };
  return {
    snapshot: () => structuredClone(state),
    injectFault: () => { throw new Error("injected persistence failure"); },
    restore: (value) => { state = structuredClone(value); },
    stopStrategy: () => { state = { ...state, strategyStatus: "STOPPED" }; },
    disableAutoTrade: () => { state = { ...state, autoTradeEnabled: false }; },
    faultControlPlane: () => { state = { ...state, controlState: "FAULTED" }; },
    isCommandBlocked: () => state.controlState === "FAULTED"
  };
};

for (const scenario of ["PERSISTENCE_FAILURE", "PARTIAL_WRITE"]) {
  test(`${scenario} passes only after every fail-closed postcondition`, () => {
    const result = runPaperFaultDrill(scenario, hooks());
    assert.equal(result.status, "PASS");
    assert.equal(result.errorObserved, true);
    assert.equal(result.rollbackVerified, true);
    assert.equal(result.noPartialPersistenceVerified, true);
    assert.equal(result.strategyStopped, true);
    assert.equal(result.autoTradeDisabled, true);
    assert.equal(result.controlFaulted, true);
    assert.equal(result.commandsBlocked, true);
  });
}

test("an observed error without postconditions is not PASS", () => {
  const result = runPaperFaultDrill("PERSISTENCE_FAILURE", { ...hooks(), stopStrategy: () => {}, disableAutoTrade: () => {}, faultControlPlane: () => {}, isCommandBlocked: () => false });
  assert.equal(result.status, "FAIL");
});
