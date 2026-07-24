const test = require("node:test");
const assert = require("node:assert/strict");
const { reconcileReferenceAccounting } = require("../dist/apps/server/src/referenceReconciliation.js");

function account(overrides = {}) {
  return Object.freeze({
    cash: 1_000_000,
    equity: 1_000_000,
    unrealizedPnl: 0,
    position: Object.freeze({ market: "KRW-BTC", quantity: 0, averagePrice: 0, realizedPnl: 0, ...overrides.position }),
    orders: [],
    ...overrides
  });
}
function portfolio(overrides = {}) {
  return Object.freeze({ cash: 1_000_000, quantity: 0, averagePrice: 0, realizedPnl: 0, ...overrides });
}

test("identical account and reference portfolio are consistent with no discrepancies", () => {
  const result = reconcileReferenceAccounting(
    account({ cash: 500_000, position: { quantity: 1, averagePrice: 100, realizedPnl: 10 } }),
    portfolio({ cash: 500_000, quantity: 1, averagePrice: 100, realizedPnl: 10 })
  );
  assert.equal(result.consistent, true);
  assert.deepEqual(result.discrepancies, []);
});

test("a cash mismatch is reported", () => {
  const result = reconcileReferenceAccounting(account({ cash: 500_000 }), portfolio({ cash: 400_000 }));
  assert.equal(result.consistent, false);
  assert.equal(result.discrepancies.length, 1);
  assert.match(result.discrepancies[0], /^cash:/);
});

test("a quantity mismatch is reported", () => {
  const result = reconcileReferenceAccounting(account({ position: { quantity: 1 } }), portfolio({ quantity: 2 }));
  assert.equal(result.consistent, false);
  assert.ok(result.discrepancies.some((d) => d.startsWith("quantity:")));
});

test("a realizedPnl mismatch is reported", () => {
  const result = reconcileReferenceAccounting(account({ position: { realizedPnl: 5 } }), portfolio({ realizedPnl: -5 }));
  assert.equal(result.consistent, false);
  assert.ok(result.discrepancies.some((d) => d.startsWith("realizedPnl:")));
});

test("averagePrice mismatch is reported while a position is held", () => {
  const result = reconcileReferenceAccounting(
    account({ position: { quantity: 1, averagePrice: 100 } }),
    portfolio({ quantity: 1, averagePrice: 200 })
  );
  assert.equal(result.consistent, false);
  assert.ok(result.discrepancies.some((d) => d.startsWith("averagePrice:")));
});

test("averagePrice mismatch is ignored once flat (both sides meaningless at zero quantity)", () => {
  const result = reconcileReferenceAccounting(
    account({ position: { quantity: 0, averagePrice: 0 } }),
    portfolio({ quantity: 0, averagePrice: 1e-9 })
  );
  assert.equal(result.consistent, true);
});

test("sub-epsilon floating-point differences are not flagged", () => {
  const result = reconcileReferenceAccounting(
    account({ cash: 500_000.0000001, position: { quantity: 1.0000000001, averagePrice: 100, realizedPnl: 0 } }),
    portfolio({ cash: 500_000, quantity: 1, averagePrice: 100, realizedPnl: 0 })
  );
  assert.equal(result.consistent, true);
});

test("multiple simultaneous mismatches are all reported", () => {
  const result = reconcileReferenceAccounting(
    account({ cash: 1, position: { quantity: 1 } }),
    portfolio({ cash: 2, quantity: 2 })
  );
  assert.equal(result.discrepancies.length, 2);
});

test("reconcileReferenceAccounting never mutates its inputs", () => {
  const acct = account({ cash: 500_000, position: { quantity: 1, averagePrice: 100 } });
  const port = portfolio({ cash: 400_000, quantity: 2 });
  const acctBefore = JSON.parse(JSON.stringify(acct));
  const portBefore = JSON.parse(JSON.stringify(port));
  reconcileReferenceAccounting(acct, port);
  assert.deepEqual(JSON.parse(JSON.stringify(acct)), acctBefore);
  assert.deepEqual(JSON.parse(JSON.stringify(port)), portBefore);
});
