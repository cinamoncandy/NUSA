const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { DesktopPersistenceStore } = require("../dist/apps/desktop/src/persistence/desktopPersistenceStore.js");

const path = () => join(mkdtempSync(join(tmpdir(), "nusa-atomic-evidence-")), "runtime.db");
const state = () => ({ paper: { version: 1, market: "KRW-BTC", cash: 1000, feeRate: 0.001, position: { market: "KRW-BTC", quantity: 0, averagePrice: 0, realizedPnl: 0 }, orders: [] }, control: { version: 1, strategyId: "sma-crossover", status: "STOPPED", autoTradeEnabled: false, orderQuantity: 1, events: [], processedSignalKeys: [] } });

test("runtime state and evidence event commit together", () => {
  const store = new DesktopPersistenceStore(path()); const value = state();
  store.saveWithScenarioEvent(value.paper, value.control, { eventId: "e1", type: "SESSION_OBSERVED", occurredAt: 1, sessionId: "s1" });
  assert.equal(store.load().paper.cash, 1000);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM desktop_paper_scenario_evidence").get().count, 1);
  store.close();
});

test("evidence failure rolls back runtime state", () => {
  const store = new DesktopPersistenceStore(path()); const value = state(); store.save(value.paper, value.control);
  store.db.exec("CREATE TRIGGER reject_evidence BEFORE INSERT ON desktop_paper_scenario_evidence BEGIN SELECT RAISE(ABORT, 'forced evidence failure'); END");
  assert.throws(() => store.saveWithScenarioEvent({ ...value.paper, cash: 1 }, value.control, { eventId: "e1", type: "SESSION_OBSERVED", occurredAt: 1, sessionId: "s1" }), /forced evidence failure/);
  assert.equal(store.load().paper.cash, 1000); assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM desktop_paper_scenario_evidence").get().count, 0); store.close();
});
