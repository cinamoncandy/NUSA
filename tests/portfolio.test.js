const test = require("node:test");
const assert = require("node:assert/strict");
const { DefaultPortfolioLedger } = require("../dist/packages/core/src/portfolio/portfolio.js");

const clone = (value) => JSON.parse(JSON.stringify(value));

function portfolio(overrides = {}) {
  return Object.freeze({ cash: 10_000_000, quantity: 0, averagePrice: 0, realizedPnl: 0, ...overrides });
}
function filled(side, quantity, price, fee) {
  return Object.freeze({ status: "FILLED", side, quantity, price, fee, orderValue: price * quantity });
}
function rejected(reason = "test rejection") {
  return Object.freeze({ status: "REJECTED", reason });
}

test("BUY reduces cash by orderValue+fee and sets averagePrice from an empty position", () => {
  const ledger = new DefaultPortfolioLedger();
  const result = ledger.apply(portfolio(), filled("BUY", 2, 100, 1));
  assert.equal(result.status, "UPDATED");
  assert.equal(result.portfolio.cash, 10_000_000 - 200 - 1);
  assert.equal(result.portfolio.quantity, 2);
  assert.equal(result.portfolio.averagePrice, 100);
  assert.equal(result.portfolio.realizedPnl, 0);
});

test("a second BUY computes a notional-weighted average price", () => {
  const ledger = new DefaultPortfolioLedger();
  const first = ledger.apply(portfolio(), filled("BUY", 2, 100, 0));
  const second = ledger.apply(first.portfolio, filled("BUY", 2, 200, 0));
  assert.equal(second.status, "UPDATED");
  assert.equal(second.portfolio.quantity, 4);
  // (2*100 + 2*200) / 4 = 150
  assert.equal(second.portfolio.averagePrice, 150);
});

test("SELL increases cash by orderValue-fee and realizes PnL from the average price", () => {
  const ledger = new DefaultPortfolioLedger();
  const held = portfolio({ cash: 1_000, quantity: 2, averagePrice: 100, realizedPnl: 0 });
  const result = ledger.apply(held, filled("SELL", 1, 150, 1));
  assert.equal(result.status, "UPDATED");
  assert.equal(result.portfolio.cash, 1_000 + 150 - 1);
  assert.equal(result.portfolio.quantity, 1);
  assert.equal(result.portfolio.averagePrice, 100, "averagePrice is unchanged while a partial position remains");
  assert.equal(result.portfolio.realizedPnl, (150 - 100) * 1 - 1);
});

test("SELLing the full remaining position resets averagePrice to 0", () => {
  const ledger = new DefaultPortfolioLedger();
  const held = portfolio({ cash: 0, quantity: 2, averagePrice: 100 });
  const result = ledger.apply(held, filled("SELL", 2, 120, 0));
  assert.equal(result.status, "UPDATED");
  assert.equal(result.portfolio.quantity, 0);
  assert.equal(result.portfolio.averagePrice, 0);
});

test("a REJECTED report is a no-op: the portfolio is returned unchanged", () => {
  const ledger = new DefaultPortfolioLedger();
  const held = portfolio({ cash: 5_000, quantity: 1, averagePrice: 90, realizedPnl: 10 });
  const result = ledger.apply(held, rejected());
  assert.equal(result.status, "UPDATED");
  assert.deepEqual(result.portfolio, held);
});

test("BUY at exactly the available cash boundary succeeds; one unit over fails INSUFFICIENT_CASH", () => {
  const ledger = new DefaultPortfolioLedger();
  const atBoundary = ledger.apply(portfolio({ cash: 201 }), filled("BUY", 2, 100, 1));
  assert.equal(atBoundary.status, "UPDATED");
  assert.equal(atBoundary.portfolio.cash, 0);

  const overBoundary = ledger.apply(portfolio({ cash: 200 }), filled("BUY", 2, 100, 1));
  assert.equal(overBoundary.status, "FAILED");
  assert.equal(overBoundary.code, "INSUFFICIENT_CASH");
});

test("SELLing exactly the held quantity succeeds; one unit over fails INSUFFICIENT_POSITION", () => {
  const ledger = new DefaultPortfolioLedger();
  const atBoundary = ledger.apply(portfolio({ quantity: 2, averagePrice: 50 }), filled("SELL", 2, 60, 0));
  assert.equal(atBoundary.status, "UPDATED");
  assert.equal(atBoundary.portfolio.quantity, 0);

  const overBoundary = ledger.apply(portfolio({ quantity: 2, averagePrice: 50 }), filled("SELL", 3, 60, 0));
  assert.equal(overBoundary.status, "FAILED");
  assert.equal(overBoundary.code, "INSUFFICIENT_POSITION");
});

test("INVALID_PORTFOLIO for negative or non-finite portfolio fields", () => {
  const ledger = new DefaultPortfolioLedger();
  for (const bad of [
    portfolio({ cash: -1 }),
    portfolio({ quantity: -1 }),
    portfolio({ averagePrice: -1 }),
    portfolio({ cash: Number.NaN }),
    portfolio({ realizedPnl: Number.POSITIVE_INFINITY })
  ]) {
    const result = ledger.apply(bad, filled("BUY", 1, 100, 0));
    assert.equal(result.status, "FAILED", JSON.stringify(bad));
    assert.equal(result.code, "INVALID_PORTFOLIO");
  }
});

test("INVALID_EXECUTION_REPORT for a FILLED report with invalid quantity/price/fee/orderValue", () => {
  const ledger = new DefaultPortfolioLedger();
  const cases = [
    filled("BUY", 0, 100, 0),
    filled("BUY", -1, 100, 0),
    filled("BUY", 1, 0, 0),
    filled("BUY", 1, 100, -1),
    Object.freeze({ status: "FILLED", side: "BUY", quantity: 1, price: 100, fee: 0, orderValue: 0 })
  ];
  for (const report of cases) {
    const result = ledger.apply(portfolio(), report);
    assert.equal(result.status, "FAILED", JSON.stringify(report));
    assert.equal(result.code, "INVALID_EXECUTION_REPORT");
  }
});

test("validation order: INVALID_PORTFOLIO wins even when the report is also invalid", () => {
  const ledger = new DefaultPortfolioLedger();
  const result = ledger.apply(portfolio({ cash: -1 }), filled("BUY", -1, -1, -1));
  assert.equal(result.status, "FAILED");
  assert.equal(result.code, "INVALID_PORTFOLIO");
});

test("inputs (Portfolio, ExecutionReport) are never mutated", () => {
  const ledger = new DefaultPortfolioLedger();
  const portfolioValue = portfolio({ cash: 1_000_000, quantity: 1, averagePrice: 100 });
  const reportValue = filled("BUY", 1, 110, 1);
  const portfolioBefore = clone(portfolioValue);
  const reportBefore = clone(reportValue);

  ledger.apply(portfolioValue, reportValue);

  assert.deepEqual(clone(portfolioValue), portfolioBefore);
  assert.deepEqual(clone(reportValue), reportBefore);
});

test("apply() is deterministic: identical inputs always produce identical results", () => {
  const ledger = new DefaultPortfolioLedger();
  const results = Array.from({ length: 5 }, () => ledger.apply(portfolio({ cash: 1_000_000 }), filled("BUY", 1, 100, 1)));
  for (const result of results) assert.deepEqual(result, results[0]);
});
