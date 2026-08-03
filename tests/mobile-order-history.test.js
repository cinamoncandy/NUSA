const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildOrderHistoryViewModel, parseOrderHistory } = require("../dist/apps/mobile/src/orderHistory.js");

const orders = Array.from({ length: 23 }, (_, index) => ({ id: `order-${index}`, market: index % 2 ? "KRW-ETH" : "KRW-BTC", side: index % 2 ? "SELL" : "BUY", quantity: index + 1, price: 100 + index, fee: 1, filledAt: `2026-08-03T00:${String(index).padStart(2, "0")}:00.000Z`, status: index === 1 ? "CANCELLED" : "FILLED" }));

test("order history parser validates persisted Paper orders and rejects duplicates", () => {
  assert.equal(parseOrderHistory(orders).length, 23);
  assert.equal(parseOrderHistory([{ ...orders[0] }])[0].status, "FILLED");
  assert.throws(() => parseOrderHistory([{ ...orders[0] }, { ...orders[0] }]), /duplicate order/);
  assert.throws(() => parseOrderHistory([{ ...orders[0], market: "BTC" }]), /order 0 is invalid/);
  assert.throws(() => parseOrderHistory([{ ...orders[0], status: "UNKNOWN" }]), /order 0 is invalid/);
});

test("order history supports filters, search, sorting and deterministic paging", () => {
  const page = buildOrderHistoryViewModel({ rawOrders: orders, query: "KRW-BTC", filter: "FILLED", sort: "PRICE_DESC", page: 1, pageSize: 5 });
  assert.equal(page.state, "READY");
  assert.equal(page.pageCount, 3);
  assert.equal(page.total, 12);
  assert.equal(page.orders[0].price, 122);
  assert.equal(buildOrderHistoryViewModel({ rawOrders: orders, query: "order-1", filter: "CANCELLED", sort: "TIME_DESC", page: 1 }).total, 1);
  assert.equal(buildOrderHistoryViewModel({ rawOrders: [], query: "", filter: "ALL", sort: "TIME_DESC", page: 1 }).state, "EMPTY");
  assert.equal(buildOrderHistoryViewModel({ rawOrders: null, query: "", filter: "ALL", sort: "TIME_DESC", page: 1 }).state, "LOADING");
});

test("order history UI uses design system, read-only data, and all required states", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "orderHistoryView.tsx"), "utf8");
  assert.match(source, /Order History/);
  assert.match(source, /order-history-filters/);
  assert.match(source, /order-history-sorts/);
  assert.match(source, /order-history-pagination/);
  assert.match(source, /order-history-loading/);
  assert.match(source, /order-history-error/);
  assert.match(source, /order-history-empty/);
  assert.match(source, /NusaCard/);
  assert.doesNotMatch(source, /placeOrder|cancelOrder|withdraw|fetch\(/);
  const app = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");
  assert.match(app, /activeTab === "More"/);
  assert.match(app, /<MoreView/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "moreView.tsx"), "utf8"), /<OrderHistoryView/);
  assert.match(app, /account\?\.account\.orders/);
});
