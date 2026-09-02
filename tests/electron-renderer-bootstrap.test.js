const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const rendererDir = path.join(root, "apps", "desktop", "renderer");
const read = (name) => fs.readFileSync(path.join(rendererDir, name), "utf8");
const html = read("index.html");
const runtime = read("app-runtime.js");
const accessibility = read("app-accessibility.js");

test("canonical index parses with one app root and no duplicate ids", () => {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const app = document.querySelector('[data-testid="nusa-app-root"][data-runtime-owner="canonical"]');
  assert.ok(app, "expected one canonical NUSA app root");
  assert.equal(document.querySelectorAll('[data-testid="nusa-app-root"]').length, 1);
  assert.ok(document.querySelector("main"));

  const idPattern = /\bid="([^"]+)"/g;
  const seen = new Map();
  let match;
  while ((match = idPattern.exec(html)) !== null) seen.set(match[1], (seen.get(match[1]) ?? 0) + 1);
  const duplicates = [...seen.entries()].filter(([, count]) => count > 1);
  assert.deepEqual(duplicates, [], `expected no duplicate ids: ${duplicates.map(([id]) => id).join(", ")}`);
});

test("canonical index declares the complete user navigation and matching pages", () => {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const routes = ["dashboard", "orders", "positions", "strategy", "logs", "settings"];
  for (const route of routes) {
    assert.ok(document.querySelector(`[data-simple-nav="${route}"]`), `missing nav ${route}`);
    assert.ok(document.querySelector(`[data-simple-page="${route}"]`), `missing page ${route}`);
  }
  assert.equal(document.querySelector('[data-simple-nav="dashboard"]').getAttribute("aria-current"), "page");
});

test("canonical script stack is explicit and legacy active renderers are not loaded", () => {
  for (const script of ["mobile-view-model.js", "app-runtime.js", "app-adapter.js", "app-accessibility.js"]) {
    assert.match(html, new RegExp(`src="${script.replace(".", "\\.")}"`));
  }
  for (const retired of ["renderer.js", "simple-ui.js", "brand-ui.js", "workspace.js", "command-palette.js", "application-state.js", "control-room.js", "product-screens.js"]) {
    assert.doesNotMatch(html, new RegExp(`src="${retired.replace(".", "\\.")}"`));
  }
});

test("initial execution surface is fail-closed and unmistakably Paper-only", () => {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  assert.match(document.body.textContent, /PAPER · 실거래 비활성/);
  assert.match(document.body.textContent, /실거래 주문을 전송하지 않습니다/);
  for (const side of ["BUY", "SELL"]) {
    const button = document.querySelector(`[data-simple-order="${side}"]`);
    assert.ok(button, `missing ${side} Paper button`);
    assert.equal(button.disabled, true, `${side} must start disabled before verified market state`);
  }
  assert.doesNotMatch(html, /LIVE TRADING ENABLED|withdraw|transfer/i);
});

test("runtime subscribes only to declared preload projections and owns cleanup", () => {
  for (const subscription of ["onStatus", "onTicker", "onSnapshot", "onControl", "onChartPoint"]) {
    assert.match(runtime, new RegExp(`api\\.${subscription}`));
  }
  assert.match(runtime, /unsubscribers/);
  assert.match(runtime, /cleanup/);
  assert.match(runtime, /beforeunload|pagehide/);
  assert.doesNotMatch(runtime, /ipcRenderer|require\(["']electron["']\)/);
});

test("runtime fails closed for disconnected, invalid-price, invalid-quantity and duplicate order states", () => {
  assert.match(runtime, /state\.connection !== "connected"/);
  assert.match(runtime, /!finite\(state\.lastPrice\)/);
  assert.match(runtime, /!finite\(quantity\) \|\| quantity <= 0/);
  assert.match(runtime, /state\.orderSubmitting/);
  assert.match(runtime, /button\.disabled = Boolean\(reason\)/);
});

test("canonical order confirmation is modal, focus-contained, and Escape-closeable", () => {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const dialog = document.querySelector('[data-simple-sheet][role="dialog"]');
  assert.ok(dialog);
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  assert.match(accessibility, /event\.key !== "Tab"/);
  assert.match(accessibility, /focus/);
  assert.match(runtime, /event\.key === "Escape" && state\.pendingOrder/);
  assert.match(runtime, /closeOrderSheet\(\)/);
});
