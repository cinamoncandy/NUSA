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

function bootstrap({ snapshot = null, control = null, snapshotError = false } = {}) {
  const dom = new JSDOM(html, { url: "http://localhost/", pretendToBeVisual: true, runScripts: "dangerously" });
  const { window } = dom;
  const handlers = {};
  window.nusa = {
    getSnapshot: () => snapshotError ? Promise.reject(new Error("cloud unavailable")) : Promise.resolve(snapshot),
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

function settle() { return new Promise((resolve) => setImmediate(resolve)); }

test("canonical UI exposes five supervision destinations and no manual PAPER order controls", () => {
  const { dom, window } = bootstrap();
  const nav = [...window.document.querySelectorAll(".nusa-sidebar [data-nav]")];
  assert.equal(nav.length, 5);
  assert.deepEqual(nav.map((button) => button.dataset.nav), ["dashboard", "portfolio", "nusa", "logs", "settings"]);
  assert.equal(window.document.querySelectorAll(".nusa-bottom-nav [data-nav]").length, 5);
  assert.match(window.document.body.textContent, /PAPER 자동 학습/);
  assert.match(window.document.body.textContent, /REAL 승인 필요/);
  assert.match(window.document.body.textContent, /PAPER 학습 결과/);
  assert.doesNotMatch(window.document.querySelector("#simple-ui-root").textContent, /Paper 매수|Paper 매도|주문 수량/);
  assert.doesNotMatch(script, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  dom.window.close();
});

test("home keeps REAL fail-closed while showing PAPER learning outcomes", async () => {
  const { dom, window } = bootstrap({ snapshot: {
    equity: 10_000_000,
    cash: 10_000_000,
    unrealizedPnl: 125_000,
    position: { market: "KRW-BTC", quantity: 0, averagePrice: 0, realizedPnl: 50_000 },
    orders: [{ side: "BUY" }, { side: "SELL" }]
  } });
  await settle();
  const home = window.document.querySelector('[data-page="dashboard"]');
  const realAssetCard = [...home.querySelectorAll(".nusa-card")].find((card) => card.textContent.includes("REAL 총 자산"));
  const paperCard = [...home.querySelectorAll(".nusa-card")].find((card) => card.textContent.includes("PAPER 학습 결과"));
  assert.match(realAssetCard.textContent, /연결 전/);
  assert.doesNotMatch(realAssetCard.textContent, /10,000,000/);
  assert.match(paperCard.textContent, /10,000,000/);
  assert.match(paperCard.textContent, /2건/);
  dom.window.close();
});

test("market connection is observational and never exposes manual order actions", async () => {
  const { dom, window, handlers } = bootstrap();
  await settle();
  handlers.ticker({ trade_price: 90_000_000, signed_change_rate: 0.01 });
  handlers.status("disconnected");
  assert.match(window.document.querySelector("[data-connection]").textContent, /업비트.*연결 끊김|업비트.*연결 이상/);
  handlers.status("connected");
  assert.match(window.document.querySelector("[data-connection]").textContent, /서버 · 업비트 정상/);
  assert.match(window.document.querySelector('[data-page="dashboard"]').textContent, /90,000,000/);
  assert.equal(window.document.querySelectorAll("[data-simple-order], [data-order]").length, 0);
  dom.window.close();
});

test("validated Upbit ticker repairs a missed initial connected event", async () => {
  const { dom, window, handlers } = bootstrap();
  await settle();
  assert.match(window.document.querySelector("[data-connection]").textContent, /업비트 확인 중/);
  handlers.ticker({ trade_price: 91_234_567, signed_change_rate: 0.0025 });
  assert.equal(window.NUSASimpleUI.state.connectionCode, "connected");
  assert.match(window.document.querySelector("[data-connection]").textContent, /서버 · 업비트 정상/);
  assert.match(window.document.querySelector('[data-page="dashboard"]').textContent, /91,234,567/);
  dom.window.close();
});

test("cloud snapshot failure is distinct from Upbit and successful polling recovers it", async () => {
  const { dom, window, handlers } = bootstrap({ snapshotError: true });
  handlers.ticker({ trade_price: 92_000_000, signed_change_rate: -0.003 });
  await settle();
  assert.equal(window.NUSASimpleUI.state.serverConnectionCode, "disconnected");
  assert.match(window.document.querySelector("[data-connection]").textContent, /서버.*연결/);
  handlers.snapshot({ equity: 10_000_000, cash: 10_000_000, unrealizedPnl: 0, position: { quantity: 0, realizedPnl: 0 }, orders: [] });
  assert.equal(window.NUSASimpleUI.state.serverConnectionCode, "connected");
  assert.match(window.document.querySelector("[data-connection]").textContent, /서버 · 업비트 정상/);
  window.document.querySelector(".nusa-sidebar [data-nav='settings']").click();
  const settings = window.document.querySelector('[data-page="settings"]');
  assert.match(settings.textContent, /NUSA 서버.*정상/s);
  assert.match(settings.textContent, /업비트 공개 시세.*정상/s);
  dom.window.close();
});

test("server connection has a bounded stale watchdog and no local fallback", () => {
  assert.match(script, /SERVER_SNAPSHOT_STALE_MS\s*=\s*7_000/);
  assert.match(script, /serverLastSuccessAt/);
  assert.match(script, /state\.serverConnectionCode\s*=\s*"disconnected"/);
  assert.doesNotMatch(script, /PaperBroker|paper:snapshot|global\.nusa\.placeOrder/);
});

test("canonical navigation is keyboard-addressable and shows one page at a time", () => {
  const { dom, window } = bootstrap();
  const portfolio = window.document.querySelector(".nusa-sidebar [data-nav='portfolio']");
  portfolio.click();
  assert.equal(window.document.querySelector('[data-page="portfolio"]').hidden, false);
  assert.equal(window.document.querySelector('[data-page="dashboard"]').hidden, true);
  assert.equal(portfolio.getAttribute("aria-current"), "page");
  assert.equal(window.document.querySelector(".nusa-bottom-nav [data-nav='portfolio']").getAttribute("aria-current"), "page");
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  dom.window.close();
});

test("REAL approval policy is explicit while renderer exposes no execution mutation", () => {
  const { dom, window } = bootstrap();
  window.document.querySelector(".nusa-sidebar [data-nav='settings']").click();
  const settings = window.document.querySelector('[data-page="settings"]');
  assert.match(settings.textContent, /비밀번호 \+ 지문/);
  assert.match(settings.textContent, /단일 인증 우회/);
  assert.match(settings.textContent, /허용 안 함/);
  assert.match(settings.textContent, /판단됨 ≠ 승인됨 ≠ 주문됨 ≠ 체결됨/);
  assert.doesNotMatch(script, /placeOrder|enableLiveTrading|privateApi|productionMutationAllowed/);
  assert.doesNotMatch(window.document.querySelector("#simple-ui-root").textContent, /Access Key|Secret Key|JWT|Authorization/);
  dom.window.close();
});

test("dynamic control messages are rendered as text rather than executable markup", async () => {
  const hostile = '<img src=x onerror="window.__nusaInjected=true">';
  const { dom, window } = bootstrap({ control: { status: "RUNNING", autoTradeEnabled: true, events: [{ type: "BUY", message: hostile }] } });
  await settle();
  const judgement = window.document.querySelector('[data-page="dashboard"] .nusa-judgement');
  assert.match(judgement.textContent, /<img src=x/);
  assert.equal(judgement.querySelectorAll("img").length, 0);
  assert.equal(window.__nusaInjected, undefined);
  window.document.querySelector(".nusa-sidebar [data-nav='logs']").click();
  const logs = window.document.querySelector('[data-page="logs"]');
  assert.match(logs.textContent, /<img src=x/);
  assert.equal(logs.querySelectorAll("img").length, 0);
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