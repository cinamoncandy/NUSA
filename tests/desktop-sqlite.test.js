const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { DesktopPersistenceStore } = require("../dist/apps/desktop/src/persistence/desktopPersistenceStore.js");
const { ControlPlane } = require("../dist/apps/desktop/src/control/controlPlane.js");
const { PaperBroker } = require("../dist/apps/desktop/src/paper/paperBroker.js");

const state = () => {
  const broker = new PaperBroker();
  const control = new ControlPlane();
  control.start();
  control.claimAutomaticSignal("KRW-BTC:1:BUY");
  broker.execute("BUY", 0.001, 1000, new Date("2026-01-01T00:00:00Z"));
  return { paper: broker.exportState(), control: control.exportState() };
};
const dbPath = () => join(mkdtempSync(join(tmpdir(), "nusa-sqlite-")), "runtime.db");

test("fresh SQLite install creates schema and starts empty", () => {
  const store = new DesktopPersistenceStore(dbPath());
  assert.equal(store.load(), undefined);
  store.close();
});

test("paper account, orders, control events, and signal keys survive restart", () => {
  const filename = dbPath(); const expected = state();
  const first = new DesktopPersistenceStore(filename); first.save(expected.paper, expected.control); first.close();
  const second = new DesktopPersistenceStore(filename); assert.deepEqual(second.load(), JSON.parse(JSON.stringify(expected))); second.close();
});

test("legacy JSON state imports only once", () => {
  const store = new DesktopPersistenceStore(dbPath()); const expected = state();
  assert.equal(store.importLegacy(expected), true); assert.equal(store.importLegacy(expected), false);
  assert.deepEqual(store.load(), JSON.parse(JSON.stringify(expected))); store.close();
});

test("restart retains duplicate key and forces auto trading off", () => {
  const filename = dbPath(); const expected = state();
  const first = new DesktopPersistenceStore(filename); first.save(expected.paper, expected.control); first.close();
  const second = new DesktopPersistenceStore(filename); const restored = second.load();
  const control = new ControlPlane("sma-crossover", 200, restored.control);
  assert.equal(control.snapshot().autoTradeEnabled, false);
  assert.equal(control.claimAutomaticSignal("KRW-BTC:1:BUY"), false); second.close();
});

test("failed write rolls back every runtime table", () => {
  const store = new DesktopPersistenceStore(dbPath()); const expected = state();
  store.save(expected.paper, expected.control);
  store.db.exec("CREATE TRIGGER reject_control BEFORE INSERT ON desktop_control_state BEGIN SELECT RAISE(ABORT, 'forced rollback'); END");
  const changed = state(); changed.paper = { ...changed.paper, cash: 1 };
  assert.throws(() => store.save(changed.paper, changed.control), /forced rollback/);
  assert.deepEqual(store.load(), JSON.parse(JSON.stringify(expected))); store.close();
});

test("corrupt SQLite fails closed during construction", () => {
  const filename = dbPath(); writeFileSync(filename, "not a sqlite database");
  assert.throws(() => new DesktopPersistenceStore(filename));
});

