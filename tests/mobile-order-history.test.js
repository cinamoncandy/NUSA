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

test("order history supports deterministic periods and fill detail data", () => {
  const detailed = [{ ...orders[0], filledAt: "2026-08-01T00:00:00.000Z", fills: [{ id: "fill-1", quantity: 1, price: 100, filledAt: "2026-08-01T00:00:01.000Z" }] }];
  const within = buildOrderHistoryViewModel({ rawOrders: detailed, query: "", filter: "ALL", sort: "TIME_DESC", page: 1, period: "7D", referenceAt: "2026-08-03T00:00:00.000Z" });
  assert.equal(within.total, 1);
  assert.equal(within.orders[0].fills[0].id, "fill-1");
  assert.equal(buildOrderHistoryViewModel({ rawOrders: detailed, query: "", filter: "ALL", sort: "TIME_DESC", page: 1, period: "TODAY", referenceAt: "2026-08-03T00:00:00.000Z" }).state, "EMPTY");
});

test("order history UI uses design system and remains reachable and read-only in the command center", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "orderHistoryView.tsx"), "utf8");
  assert.match(source, /주문 이력/);
  assert.match(source, /order-history-filters/);
  assert.match(source, /order-history-sorts/);
  assert.match(source, /order-history-pagination/);
  assert.match(source, /order-history-periods/);
  assert.match(source, /fill-detail/);
  assert.match(source, /order-history-loading/);
  assert.match(source, /order-history-error/);
  assert.match(source, /order-history-empty/);
  assert.match(source, /ScreenHeader/);
  assert.match(source, /InlineNotice/);
  assert.match(source, /SegmentedControl/);
  assert.doesNotMatch(source, /placeOrder|cancelOrder|withdraw|fetch\(/);

  const primitives = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "uxPrimitives.tsx"), "utf8");
  assert.match(primitives, /segment: \{ flex: 1, minHeight: 44/);

  const app = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");
  assert.match(app, /activeTab === "AiSignal" \? \(Platform\.OS === "android"/);
  assert.match(app, /<AndroidNusaDecisionView/);
  assert.match(app, /: <AiView/);
  assert.match(app, /activeTab === "Order" \? <OrderHistoryView/);
  assert.doesNotMatch(app, /<MoreView/);
  assert.match(app, /rawOrders=\{snapshot\?\.orders \?\? null\}/);
  assert.match(app, /loadPersonalPaperOperations/);
  assert.doesNotMatch(app, /\/api\/account/);
});
