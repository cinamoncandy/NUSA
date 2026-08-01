const test = require("node:test");
const assert = require("node:assert/strict");
const { InMemoryRulesProjectionSource, RULES_STATUS_CHANNEL, registerRulesReadOnlyIpc } = require("../dist/apps/desktop/src/rulesIpcBridge.js");

test("rules IPC is read-only and fails closed without a connected ledger", () => {
  const source = new InMemoryRulesProjectionSource();
  const handlers = new Map();
  registerRulesReadOnlyIpc({ handle: (channel, listener) => handlers.set(channel, listener) }, source);
  assert.deepEqual(handlers.get(RULES_STATUS_CHANNEL)(), { ok: false, status: "NO_DATA", message: "Rules status is not available" });
  assert.equal(source.current(), null);
});

test("rules IPC returns only the published read-only projection", () => {
  const source = new InMemoryRulesProjectionSource();
  const projection = Object.freeze({ ledgerHash: "0".repeat(64), eventCount: 0, ruleVersionCount: 0, policyVersionCount: 0, formulaVersionCount: 0, decisionTraceCount: 0, decisionCounts: Object.freeze({}), latestEventType: undefined });
  source.publish(projection);
  let handler;
  registerRulesReadOnlyIpc({ handle: (_channel, listener) => { handler = listener; } }, source);
  assert.deepEqual(handler(), { ok: true, projection });
});
