const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..", "apps", "desktop", "renderer");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "simple-ui.css"), "utf8");
const viewModel = fs.readFileSync(path.join(root, "mobile-view-model.js"), "utf8");
const script = fs.readFileSync(path.join(root, "simple-ui.js"), "utf8");

function bootstrap({ snapshot = null, control = null } = {}) {
  const dom = new JSDOM(html, { url: "http://localhost/", pretendToBeVisual: true, runScripts: "dangerously" });
  const { window } = dom;
  const handlers = {};
  window.nusa = {
    getSnapshot: () => Promise.resolve(snapshot),
    getControlSnapshot: () => Promise.resolve(control),
    onStatus: (handler) => { handlers.status = handler; return () => {}; },
    onTicker: (handler) => { handlers.ticker = handler; return () => {}; },
    onSnapshot: (handler) => { handlers.snapshot = handler; return () => {}; },
    onControl: (handler) => { handlers.control = handler; return () => {}; },
    onChartPoint: (handler) => { handlers.chartPoint = handler; return () => {}; }
  };
  for (const source of [viewModel, script]) {
    const element = window.document.createElement("script");
    element.textContent = source;
    window.document.body.appendChild(element);
  }
  return { dom, window, handlers };
}

test("simple UI exposes the required Paper dashboard structure", () => {
  for (const page of ["dashboard", "market", "orders", "positions", "more"]) assert.match(html, new RegExp(`data-simple-nav="${page}"`));
  for (const page of ["dashboard", "market", "orders", "positions", "balance", "strategy", "logs", "settings", "more"]) assert.match(html, new RegExp(`data-simple-page="${page}"`));
  assert.match(html, /PAPER · 실거래 비활성/);
  assert.match(html, /Paper 매수/);
  assert.match(html, /Paper 매도/);
  assert.match(html, /실거래 · Private API · 인증 정보 비활성/);
  assert.equal((html.match(/class="simple-bottom-nav"/g) || []).length, 1);
  assert.equal((html.match(/<nav class="simple-bottom-nav"[\s\S]*?<\/nav>/g)[0].match(/data-simple-nav=/g) || []).length, 5);
  assert.doesNotMatch(script, /innerHTML/);
});

test("dashboard renders paper account values and honest empty states", async () => {
  const { dom, window } = bootstrap({ snapshot: {
    equity: 10_000_000,
    cash: 10_000_000,
    unrealizedPnl: 0,
    position: { market: "KRW-BTC", quantity: 0, averagePrice: 0, realizedPnl: 0 },
    orders: []
  } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(window.document.querySelector("[data-simple-total-equity]").textContent, /10,000,000/);
  assert.equal(window.document.querySelector("[data-simple-position-count]").textContent, "0개");
  assert.match(window.document.querySelector("[data-simple-position-table]").textContent, /보유 중인 Paper 포지션이 없습니다/);
  assert.match(window.document.querySelector("[data-simple-recent-orders]").textContent, /아직 주문 기록이 없습니다/);
  dom.window.close();
});

test("Paper actions require both market and NUSA server connection", () => {
  const { dom, window, handlers } = bootstrap();
  handlers.ticker({ trade_price: 90_000_000, signed_change_rate: 0.01 });
  handlers.status("disconnected");
  assert.equal(window.document.querySelector("[data-simple-order='BUY']").disabled, true);
  handlers.status("connected");
  assert.equal(window.document.querySelector("[data-simple-order='BUY']").disabled, true);
  handlers.snapshot({
    equity: 1_000_000,
    cash: 1_000_000,
    unrealizedPnl: 0,
    position: { market: "KRW-BTC", quantity: 0, averagePrice: 0, realizedPnl: 0 },
    orders: []
  });
  assert.equal(window.document.querySelector("[data-simple-order='BUY']").disabled, false);
  assert.match(window.document.querySelector("[data-simple-connection]").textContent, /서버 · 업비트 정상/);
  dom.window.close();
});

test("navigation is keyboard-addressable and shows one screen at a time", () => {
  const { dom, window } = bootstrap();
  const orders = window.document.querySelector("[data-simple-nav='orders']");
  orders.click();
  assert.equal(window.document.querySelector("[data-simple-page='orders']").hidden, false);
  assert.equal(window.document.querySelector("[data-simple-page='dashboard']").hidden, true);
  assert.equal(orders.getAttribute("aria-current"), "page");
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  dom.window.close();
});

test("renderer surface is read-only with no credential or live mutation UI", () => {
  assert.doesNotMatch(html, /Access Key|Secret Key|JWT|Authorization/);
  assert.doesNotMatch(script, /enableLiveTrading|privateApi|credential|productionMutationAllowed/);
  assert.match(script, /placeOrder\(side, quantity\)/);
  assert.match(script, /Paper 주문이 기록되었습니다/);
});

test("Paper order requires an explicit confirmation sheet before IPC mutation", async () => {
  const { dom, window, handlers } = bootstrap();
  let calls = 0;
  window.nusa.placeOrder = async (side, quantity) => {
    calls += 1;
    assert.equal(side, "BUY");
    assert.equal(quantity, 0.001);
    return { snapshot: { equity: 1000000, cash: 1000000, position: { quantity: 0 }, orders: [] } };
  };
  handlers.ticker({ trade_price: 90000000, signed_change_rate: 0.01 });
  handlers.status("connected");
  const trigger = window.document.querySelector("[data-simple-order='BUY']");
  trigger.click();
  assert.equal(window.document.querySelector("[data-simple-sheet]").hidden, false);
  assert.match(window.document.querySelector("[data-simple-sheet]").textContent, /Paper 주문 확인/);
  assert.equal(calls, 0);
  window.document.querySelector("[data-simple-sheet-confirm]").click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(window.document.querySelector("[data-simple-sheet]").hidden, true);
  dom.window.close();
});

test("Escape closes the Paper order confirmation and restores the trigger", () => {
  const { dom, window, handlers } = bootstrap();
  handlers.ticker({ trade_price: 90000000 });
  handlers.status("connected");
  const trigger = window.document.querySelector("[data-simple-order='BUY']");
  trigger.focus();
  trigger.click();
  assert.equal(window.document.querySelector("[data-simple-sheet]").hidden, false);
  window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
  assert.equal(window.document.querySelector("[data-simple-sheet]").hidden, true);
  assert.equal(window.document.activeElement, trigger);
  dom.window.close();
});

test("mobile view model distinguishes unavailable values from zero", () => {
  const { dom, window } = bootstrap({ snapshot: { equity: 0, cash: 0, unrealizedPnl: 0, position: { quantity: 0, realizedPnl: 0 }, orders: [] } });
  const summary = window.NUSAMobileViewModel.summarize({ equity: 0, cash: 0, unrealizedPnl: 0, position: { quantity: 0, realizedPnl: 0 }, orders: [] }, null);
  assert.equal(summary.total, 0);
  assert.equal(summary.heldValue, null);
  assert.equal(window.NUSAMobileViewModel.formatMoney(undefined), "-");
  assert.equal(window.NUSAMobileViewModel.formatMoney(0), "₩0");
  assert.deepEqual(Array.from(window.NUSAMobileViewModel.normalizeConnection("disconnected")), ["disconnected", "연결 끊김"]);
  dom.window.close();
});