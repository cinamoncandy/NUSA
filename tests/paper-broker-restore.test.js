const test = require("node:test");
const assert = require("node:assert/strict");
const { PaperBroker } = require("../dist/packages/core/src/paperBroker.js");

function tradedBroker() {
  const broker = new PaperBroker(10_000_000, "KRW-BTC", 0.0005);
  broker.execute("BUY", 0.01, 100_000_000, new Date(1_000));
  broker.execute("BUY", 0.02, 101_000_000, new Date(2_000));
  broker.execute("SELL", 0.015, 102_000_000, new Date(3_000));
  return broker;
}

test("honest export round-trips through ledger replay", () => {
  const broker = tradedBroker();
  const snapshot = broker.exportState();
  assert.ok(snapshot.ledger.length > 0);
  const restored = new PaperBroker(1_000_000, "KRW-BTC", 0.0005, {}, snapshot);
  assert.equal(restored.exportState().cash, snapshot.cash);
  assert.equal(restored.exportState().position.quantity, snapshot.position.quantity);
});

test("tampered snapshot cash is overridden by the authoritative ledger", () => {
  const snapshot = tradedBroker().exportState();
  const tampered = { ...snapshot, cash: snapshot.cash + 1_000 };
  const restored = new PaperBroker(1_000_000, "KRW-BTC", 0.0005, {}, tampered);
  assert.equal(restored.exportState().cash, snapshot.cash);
});

test("tampered ledger entries change the replay instead of throwing", () => {
  const snapshot = tradedBroker().exportState();
  const tamperedLedger = snapshot.ledger.map((entry, index) =>
    index === 0 ? { ...entry, price: entry.price + 1_000_000 } : entry
  );
  const restored = new PaperBroker(1_000_000, "KRW-BTC", 0.0005, {}, { ...snapshot, ledger: tamperedLedger });
  assert.notEqual(restored.exportState().cash, snapshot.cash);
});

test("empty ledgers restore without replay", () => {
  const broker = new PaperBroker(1_000_000, "KRW-BTC", 0.0005);
  const restored = new PaperBroker(1_000_000, "KRW-BTC", 0.0005, {}, broker.exportState());
  assert.equal(restored.exportState().cash, 1_000_000);
});
