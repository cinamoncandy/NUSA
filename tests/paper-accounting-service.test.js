const test = require("node:test");
const assert = require("node:assert/strict");
const { FixedPrecision, PaperAccountingService } = require("../dist/apps/desktop/src/paper/paperAccountingService.js");

test("isolates ledger-backed accounting projections per account", () => {
  const service = new PaperAccountingService(new FixedPrecision({ scale: 100 }));
  service.openAccount("a", 1000, "KRW-BTC", 0);
  service.openAccount("b", 500, "KRW-BTC", 0);
  service.execute("a", "BUY", 1, 100, new Date(1000));
  assert.equal(service.snapshot("a", 110).cash, 900);
  assert.equal(service.snapshot("b", 110).cash, 500);
  assert.deepEqual(service.listAccountIds(), ["a", "b"]);
});

test("central fixed precision rounds all accounting boundaries deterministically", () => {
  const precision = new FixedPrecision({ scale: 100 });
  assert.equal(precision.toUnits(1.005), 101n);
  assert.equal(precision.round(1.005), 1.01);
  const service = new PaperAccountingService(precision);
  service.openAccount("a", 10.005, "KRW-BTC", 0);
  service.execute("a", "BUY", 1, 1.005, new Date(1000));
  const snapshot = service.snapshot("a", 1.01);
  assert.equal(snapshot.cash, 9);
  assert.equal(snapshot.position.averagePrice, 1.01);
});

test("account restoration preserves the ledger as the source of projection", () => {
  const service = new PaperAccountingService(new FixedPrecision({ scale: 100 }));
  service.openAccount("a", 1000, "KRW-BTC", 0);
  service.execute("a", "BUY", 2, 100, new Date(1000));
  const state = service.exportAccount("a");
  const restored = new PaperAccountingService(new FixedPrecision({ scale: 100 }));
  restored.restoreAccount({ accountId: "a", broker: { ...state.broker, cash: 1, position: { ...state.broker.position, quantity: 99 } } });
  assert.equal(restored.snapshot("a", 100).cash, 800);
  assert.equal(restored.snapshot("a", 100).position.quantity, 2);
});
