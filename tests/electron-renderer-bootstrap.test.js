const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const rendererDir = path.join(root, "apps/desktop/renderer");
const read = (name) => fs.readFileSync(path.join(rendererDir, name), "utf8");
const html = read("index.html");

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

/** The real script order index.html declares -- <head> first, then the body, in document
 * order. Loaded by injecting each real local file's source as a real <script> element into
 * the jsdom document (jsdom constructed with runScripts: "dangerously"), so the code executes
 * bound to the window's own global/lexical environment -- window.eval() does NOT do this in
 * jsdom (confirmed: a script evaluated via window.eval() throws "document is not defined" from
 * deeper in its own call stack, even though `typeof window` at the top level resolves fine).
 * The strict CSP meta tag in index.html never gets a chance to block anything here since jsdom
 * does not enforce CSP from a <meta> tag, and there is no dependency on jsdom's network/resource
 * loader since these are local file reads turned into inline script text. */
const SCRIPT_ORDER = [
  "theme-provider.js",
  "component-library.js",
  "command-palette.js",
  "renderer.js",
  "application-state.js",
  "application-state-mount.js"
];

/** Builds a fresh window with the real index.html DOM and a preload-shaped window.dokkaebi /
 * window.aiCioDashboard mock installed *before* any renderer script runs -- matching real
 * Electron's own guarantee that contextBridge's exposeInMainWorld() completes before the
 * page's own <script> tags execute. Returns the captured on*() handlers so the test can fire
 * events the same way the real main process would (via IPC -> preload -> these callbacks).
 */
// renderer.js's own refreshCioDashboard() re-arms a real setTimeout on every call (by design --
// it's the production polling loop), so a window left open after its test finishes would keep
// the process's event loop alive indefinitely. Every window created here is closed in the
// after() hook below; jsdom's window.close() tears down timers registered through that window.
const openWindows = [];

function bootstrapRenderer({ initialSnapshot = null, initialControl = null, aiCioResult = { ok: false, status: "NO_DATA" } } = {}) {
  const dom = new JSDOM(html, { url: "http://localhost/", pretendToBeVisual: true, runScripts: "dangerously" });
  const { window } = dom;
  openWindows.push(window);

  // jsdom has no canvas backend without the separate "canvas" native package (not installed,
  // and not something this task may add) -- this is a jsdom test-environment gap, not a real
  // Chromium/Electron limitation, so it's shimmed here in the test harness only.
  window.HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, setTransform() {},
    lineWidth: 0, strokeStyle: ""
  });
  // jsdom does not implement requestAnimationFrame at all; renderer.js only uses it to redraw
  // the chart canvas, which this harness already stubs above, so a synchronous shim is enough.
  window.requestAnimationFrame = (callback) => { callback(); return 0; };

  const handlers = {};
  const dokkaebiCalls = [];
  window.dokkaebi = {
    placeOrder: (side, quantity) => { dokkaebiCalls.push(["placeOrder", side, quantity]); return Promise.resolve({ order: {}, snapshot: initialSnapshot }); },
    getSnapshot: () => { dokkaebiCalls.push(["getSnapshot"]); return Promise.resolve(initialSnapshot); },
    getControlSnapshot: () => { dokkaebiCalls.push(["getControlSnapshot"]); return Promise.resolve(initialControl); },
    startStrategy: () => { dokkaebiCalls.push(["startStrategy"]); return Promise.resolve(initialControl); },
    stopStrategy: () => { dokkaebiCalls.push(["stopStrategy"]); return Promise.resolve(initialControl); },
    setAutoTrade: (enabled) => { dokkaebiCalls.push(["setAutoTrade", enabled]); return Promise.resolve(initialControl); },
    setStrategyQuantity: (quantity) => { dokkaebiCalls.push(["setStrategyQuantity", quantity]); return Promise.resolve(initialControl); },
    onTicker: (handler) => { handlers.ticker = handler; return () => { handlers.ticker = undefined; }; },
    onStatus: (handler) => { handlers.status = handler; return () => { handlers.status = undefined; }; },
    onSnapshot: (handler) => { handlers.snapshot = handler; return () => { handlers.snapshot = undefined; }; },
    onControl: (handler) => { handlers.control = handler; return () => { handlers.control = undefined; }; },
    onChartPoint: (handler) => { handlers.chartPoint = handler; return () => { handlers.chartPoint = undefined; }; }
  };
  window.shadowPilot = {
    preflight: () => Promise.resolve([]),
    status: () => Promise.resolve({}),
    start: () => Promise.resolve({}),
    pause: () => Promise.resolve({}),
    resume: () => Promise.resolve({}),
    stop: () => Promise.resolve({})
  };
  let aiCioCallCount = 0;
  window.aiCioDashboard = {
    getAiCioDashboard: () => { aiCioCallCount += 1; return Promise.resolve(aiCioResult); }
  };

  // Runtime errors thrown by an injected <script> do not propagate synchronously from
  // appendChild() (confirmed via probe: appendChild returns normally even when the injected
  // script throws) -- they surface only through window.onerror, matching real browser
  // behavior for parser-inserted scripts. Install the handler before injecting anything.
  const errors = [];
  let currentScriptName = null;
  window.onerror = (message, source, lineno, colno, error) => {
    errors.push({ scriptName: currentScriptName, error: error || new Error(String(message)) });
    return true;
  };

  for (const scriptName of SCRIPT_ORDER) {
    currentScriptName = scriptName;
    const script = window.document.createElement("script");
    script.textContent = read(scriptName);
    window.document.body.appendChild(script);
  }
  currentScriptName = null;

  return { dom, window, document: window.document, handlers, dokkaebiCalls, errors, getAiCioCallCount: () => aiCioCallCount };
}

after(() => {
  for (const window of openWindows) window.close();
});

test("index.html parses with the DOM ids renderer.js depends on, and no duplicate ids", () => {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  assert.ok(document.querySelector("main"), "expected a root <main> element");

  const requiredIds = [
    "status", "price", "change", "equity", "chart", "quantity", "buy", "sell", "error",
    "strategy-status", "strategy-id", "auto-trade", "strategy-quantity", "strategy-start", "strategy-stop",
    "cash", "position", "average", "unrealized", "realized", "events", "orders",
    "ai-cio-dashboard", "cio-status", "cio-freshness", "cio-portfolio", "cio-opportunity", "cio-strategy",
    "cio-committee", "cio-execution", "cio-risk", "cio-research", "cio-warnings",
    "application-state", "application-state-title", "application-state-description", "application-state-action",
    "command-palette", "command-palette-trigger", "command-palette-search", "command-palette-list"
  ];
  for (const id of requiredIds) assert.ok(document.getElementById(id), `expected #${id} to exist in index.html`);

  const idPattern = /\bid="([^"]+)"/g;
  const seen = new Map();
  let match;
  while ((match = idPattern.exec(html)) !== null) seen.set(match[1], (seen.get(match[1]) ?? 0) + 1);
  const duplicates = [...seen.entries()].filter(([, count]) => count > 1);
  assert.deepEqual(duplicates, [], `expected no duplicate ids in index.html, found: ${duplicates.map(([id]) => id).join(", ")}`);
});

test("renderer bootstraps without exceptions with no data yet available", async () => {
  const { errors, document } = bootstrapRenderer({ initialSnapshot: null, initialControl: null });
  await flushPromises();
  await flushPromises();
  assert.deepEqual(
    errors.map((entry) => `${entry.scriptName}: ${entry.error.stack || entry.error.message}`),
    [],
    "expected every renderer script to execute without throwing"
  );
  // getSnapshot()/getControlSnapshot() both resolve null before the first real ticker/control
  // snapshot arrives -- renderSnapshot()/renderControl() both no-op on a null snapshot
  // (`if (!snapshot) return;`), so the initial placeholder text must still be showing.
  assert.equal(document.getElementById("equity").textContent, "-");
  assert.equal(document.getElementById("price").textContent, "시세 대기 중");
});

test("fail-closed: initial application state is LOADING, never a trading-permitted or connected state", async () => {
  const { document } = bootstrapRenderer();
  await flushPromises();
  const state = document.getElementById("application-state");
  assert.equal(state.dataset.state, "LOADING");
  assert.notEqual(state.dataset.state, "READY");
  assert.notEqual(state.dataset.tone, "positive");
  assert.equal(document.getElementById("auto-trade").checked, false);
  assert.equal(document.getElementById("strategy-status").textContent, "STOPPED");
});

test("AI CIO dashboard unavailable on first poll renders NO_DATA, not fabricated numbers", async () => {
  const { document, getAiCioCallCount } = bootstrapRenderer({ aiCioResult: { ok: false, status: "NO_DATA" } });
  await flushPromises();
  await flushPromises();
  assert.ok(getAiCioCallCount() >= 1, "expected the renderer to poll getAiCioDashboard() at least once on load");
  assert.equal(document.getElementById("cio-status").textContent, "NO_DATA");
  for (const id of ["cio-system", "cio-opportunity", "cio-strategy", "cio-committee", "cio-execution", "cio-risk", "cio-research"]) {
    const text = document.getElementById(id).textContent;
    assert.doesNotMatch(text, /\[object Object\]/);
    assert.doesNotMatch(text, /^NaN|undefined/);
  }
});

test("market ticker event updates price without throwing or leaking [object Object]/NaN", () => {
  const { handlers, document, errors } = bootstrapRenderer();
  assert.doesNotThrow(() => handlers.ticker({ trade_price: 94_000_000, signed_change_rate: 0.0123 }));
  assert.equal(errors.length, 0);
  const priceText = document.getElementById("price").textContent;
  assert.doesNotMatch(priceText, /\[object Object\]|NaN|undefined/);
  assert.match(priceText, /94,000,000/);
});

test("control snapshot event reflects RUNNING status and an empty event log honestly", () => {
  const { handlers, document } = bootstrapRenderer();
  assert.doesNotThrow(() => handlers.control({ status: "RUNNING", strategyId: "sma-crossover", autoTradeEnabled: true, orderQuantity: 0.001, events: [] }));
  assert.equal(document.getElementById("strategy-status").textContent, "RUNNING");
  assert.equal(document.getElementById("auto-trade").checked, true);
  assert.equal(document.getElementById("events").children.length, 1);
  assert.doesNotMatch(document.getElementById("events").textContent, /\[object Object\]/);
});

test("paper snapshot event with an empty orders array renders a real empty state, not a fake fill", () => {
  const { handlers, document } = bootstrapRenderer();
  const snapshot = {
    equity: 10_000_000, cash: 10_000_000, unrealizedPnl: 0,
    position: { quantity: 0, averagePrice: null, realizedPnl: 0 },
    orders: []
  };
  assert.doesNotThrow(() => handlers.snapshot(snapshot));
  assert.match(document.getElementById("equity").textContent, /10,000,000/);
  assert.equal(document.getElementById("average").textContent, "-");
  assert.equal(document.getElementById("orders").textContent.trim(), "No fills");
});

test("disconnected market status is shown honestly and never marked online", () => {
  const { handlers, document } = bootstrapRenderer();
  assert.doesNotThrow(() => handlers.status("disconnected"));
  const status = document.getElementById("status");
  assert.equal(status.textContent, "disconnected");
  assert.equal(status.classList.contains("online"), false);
});
