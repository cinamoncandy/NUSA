const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..", "apps", "desktop", "renderer");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "app.css"), "utf8");
const runtime = fs.readFileSync(path.join(root, "app-runtime.js"), "utf8");
const viewModelSource = fs.readFileSync(path.join(root, "mobile-view-model.js"), "utf8");

test("canonical Paper UI exposes one user-facing navigation model", () => {
  for (const page of ["dashboard", "orders", "positions", "strategy", "logs", "settings"]) {
    assert.match(html, new RegExp(`data-simple-page="${page}"`));
  }
  for (const nav of ["dashboard", "orders", "positions", "strategy", "logs"]) {
    assert.match(html, new RegExp(`data-simple-nav="${nav}"`));
  }
  assert.match(html, /data-runtime-owner="canonical"/);
  assert.match(html, /PAPER · 실거래 비활성/);
  assert.match(html, /Paper 매수/);
  assert.match(html, /Paper 매도/);
});

test("retired simple presentation assets are not active", () => {
  assert.doesNotMatch(html, /simple-ui\.css|simple-ui\.js/);
  assert.match(html, /href="app\.css"/);
  assert.match(html, /src="app-runtime\.js"/);
});

test("canonical order runtime is fail-closed and explicitly confirmed", () => {
  assert.match(runtime, /const \[connectionTone\] = overallConnection\(\)/);
  assert.match(runtime, /connectionTone !== "connected"/);
  assert.match(runtime, /NUSA 서버와 시장 데이터가 모두 연결되어야 주문할 수 있습니다/);
  assert.match(runtime, /!finite\(state\.lastPrice\)/);
  assert.match(runtime, /!finite\(quantity\) \|\| quantity <= 0/);
  assert.match(runtime, /state\.orderSubmitting/);
  assert.match(runtime, /pendingOrder/);
  assert.match(runtime, /data-simple-sheet-confirm/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /Paper 주문 확인/);
});

test("canonical renderer remains presentation-only with no live credential surface", () => {
  assert.doesNotMatch(html, /Access Key|Secret Key|JWT|Authorization/);
  assert.doesNotMatch(runtime, /enableLiveTrading|privateApi|credential|productionMutationAllowed|withdraw|transfer/i);
  assert.match(runtime, /global\.nusa\.placeOrder\(side, quantity\)/);
  assert.match(runtime, /실제 주문은 발생하지 않았습니다/);
  assert.match(html, /실거래 주문을 전송하지 않습니다/);
});

test("canonical responsive CSS keeps keyboard focus and reduced-motion support", () => {
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /@media\s*\(max-width:\s*720px\)/);
});

test("mobile view model distinguishes unavailable values from zero", () => {
  const window = {};
  const context = vm.createContext({ window, console });
  context.globalThis = context;
  vm.runInContext(viewModelSource, context);
  const api = window.NUSAMobileViewModel;
  assert.ok(api);
  const summary = api.summarize({ equity: 0, cash: 0, unrealizedPnl: 0, position: { quantity: 0, realizedPnl: 0 }, orders: [] }, null);
  assert.equal(summary.total, 0);
  assert.equal(summary.heldValue, null);
  assert.equal(api.formatMoney(undefined), "-");
  assert.equal(api.formatMoney(0), "₩0");
  assert.deepEqual([...api.normalizeConnection("disconnected")], ["disconnected", "연결 끊김"]);
});
