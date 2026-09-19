import assert from "node:assert/strict";
import { test } from "node:test";
import { projectCanonicalPaperLedger } from "./canonicalPaperLedger";

const fills = [
  { fillId: "f2", orderId: "o2", market: "KRW-BTC", side: "SELL" as const, quantity: 1, price: 120, fee: 1, filledAt: 2 },
  { fillId: "f1", orderId: "o1", market: "KRW-BTC", side: "BUY" as const, quantity: 1, price: 100, fee: 1, filledAt: 1 },
];

test("projects deterministic cash, position, realized PnL and equity from fills", () => {
  const ledger = projectCanonicalPaperLedger(1_000, fills, []);
  assert.equal(ledger.cash, 1_018);
  assert.equal(ledger.realizedPnL, 18);
  assert.equal(ledger.equity, 1_018);
  assert.equal(ledger.positions["KRW-BTC"]?.quantity, 0);
});

test("includes unrealized PnL and rejects missing marks", () => {
  const ledger = projectCanonicalPaperLedger(1_000, [fills[1]!], [{ market: "KRW-BTC", markPrice: 110 }]);
  assert.equal(ledger.cash, 899);
  assert.equal(ledger.unrealizedPnL, 9);
  assert.equal(ledger.equity, 1_009);
  assert.throws(() => projectCanonicalPaperLedger(1_000, [fills[1]!], []), /missing mark/);
});

test("rejects duplicate fills and oversells", () => {
  assert.throws(() => projectCanonicalPaperLedger(1_000, [fills[1]!, fills[1]!], []), /duplicate fill/);
  assert.throws(() => projectCanonicalPaperLedger(1_000, [fills[0]!], []), /insufficient position/);
});

test("is invariant to input fill ordering and fingerprints the resulting ledger", () => {
  const a = projectCanonicalPaperLedger(1_000, fills, []);
  const b = projectCanonicalPaperLedger(1_000, [...fills].reverse(), []);
  assert.equal(a.fingerprintSha256, b.fingerprintSha256);
  assert.match(a.fingerprintSha256, /^[a-f0-9]{64}$/);
});
