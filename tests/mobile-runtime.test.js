const test = require("node:test");
const assert = require("node:assert/strict");
const { MobileRuntimeCoordinator, initialMobileRuntimeSnapshot, transitionMobileRuntime } = require("../dist/apps/mobile/src/mobileRuntime.js");

test("offline and reconnect remain fail closed until recovery matches", () => {
  let state = initialMobileRuntimeSnapshot();
  state = transitionMobileRuntime(state, { type: "NETWORK_OFFLINE" });
  assert.equal(state.tradingBlocked, true);
  assert.equal(state.network, "OFFLINE");
  state = transitionMobileRuntime(state, { type: "NETWORK_ONLINE" });
  assert.equal(state.network, "RECOVERING");
  assert.equal(state.recovery, "RECOVERING");
  assert.equal(state.tradingBlocked, true);
  state = transitionMobileRuntime(state, { type: "RECOVERY_MATCHED", version: 2 });
  assert.equal(state.tradingBlocked, false);
  assert.equal(state.lastPersistedVersion, 2);
});

test("synchronization conflict blocks trading and cannot move version backwards", () => {
  let state = transitionMobileRuntime(initialMobileRuntimeSnapshot(), { type: "SYNC_STARTED" });
  assert.equal(state.network, "SYNCING");
  state = transitionMobileRuntime(state, { type: "SYNC_CONFLICT", reason: "remote version mismatch" });
  assert.equal(state.recovery, "BLOCKED");
  assert.equal(state.tradingBlocked, true);
  assert.throws(() => transitionMobileRuntime({ ...state, lastPersistedVersion: 5 }, { type: "RECOVERY_MATCHED", version: 4 }), /cannot move backwards/);
});

test("coordinator persists every transition and only permits ready foreground paper orders", () => {
  const saved = [];
  const coordinator = new MobileRuntimeCoordinator({ load: () => undefined, save: (snapshot) => saved.push(snapshot) });
  assert.equal(coordinator.canSubmitPaperOrder(), true);
  coordinator.dispatch({ type: "APP_BACKGROUND" });
  assert.equal(coordinator.canSubmitPaperOrder(), false);
  coordinator.dispatch({ type: "APP_FOREGROUND" });
  coordinator.dispatch({ type: "NETWORK_OFFLINE" });
  assert.equal(coordinator.canSubmitPaperOrder(), false);
  coordinator.dispatch({ type: "NETWORK_ONLINE" });
  coordinator.dispatch({ type: "RECOVERY_MATCHED", version: 1 });
  assert.equal(coordinator.canSubmitPaperOrder(), true);
  assert.equal(saved.length, 5);
});
