const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const rendererDir = path.join(root, "apps", "desktop", "renderer");
const html = fs.readFileSync(path.join(rendererDir, "index.html"), "utf8");
const railSource = fs.readFileSync(path.join(rendererDir, "decision-flow-rail.js"), "utf8");
const railCss = fs.readFileSync(path.join(rendererDir, "decision-flow-rail.css"), "utf8");
const mountSource = fs.readFileSync(path.join(rendererDir, "application-state-mount.js"), "utf8");

function mountRail(connectionState = "connected") {
  const dom = new JSDOM(html, { url: "http://localhost/", pretendToBeVisual: true, runScripts: "dangerously" });
  const { document } = dom.window;
  const connection = document.querySelector("[data-simple-connection]");
  connection.dataset.state = connectionState;
  connection.textContent = connectionState === "connected" ? "연결됨" : "연결 끊김";
  document.querySelector("[data-simple-market-price]").textContent = "₩90,000,000";
  document.querySelector("[data-simple-market-status]").textContent = connection.textContent;
  document.querySelector("[data-simple-position-count]").textContent = "1개";
  document.querySelector("[data-simple-pnl]").textContent = "+₩10,000";
  document.querySelector("[data-simple-order-count]").textContent = "2건";
  document.querySelector("[data-simple-order-message]").textContent = "Paper 주문 결과";

  const script = document.createElement("script");
  script.textContent = railSource;
  document.body.append(script);
  return { dom, document };
}

test("Decision Flow Rail exposes the five-step Paper flow with accessible controls", () => {
  const { dom, document } = mountRail();
  const rail = document.querySelector("[data-decision-flow-rail]");
  const buttons = [...rail.querySelectorAll("button")];

  assert.ok(rail);
  assert.equal(rail.getAttribute("aria-label"), "의사결정 흐름");
  assert.deepEqual(
    buttons.map((button) => button.querySelector(".decision-flow-rail__label").textContent),
    ["Observe", "Assess", "Risk", "Paper Action", "Result"]
  );
  assert.deepEqual(buttons.map((button) => button.type), ["button", "button", "button", "button", "button"]);
  assert.equal(document.querySelector('[data-decision-step="assess"]').getAttribute("aria-current"), "step");
  assert.match(document.querySelector('[data-decision-value="observe"]').textContent, /KRW-BTC/);
  assert.match(document.querySelector('[data-decision-value="assess"]').textContent, /포지션 1개/);
  assert.equal(document.querySelector('[data-decision-value="risk"]').textContent, "PAPER 전용 · 실거래 비활성");
  assert.equal(document.querySelector('[data-decision-freshness="risk"]').dataset.state, "restricted");
  assert.equal(document.querySelector('[data-decision-freshness="risk"]').textContent, "실행 권한 없음");
  assert.doesNotMatch(railSource, /innerHTML/);
  dom.window.close();
});

test("Decision Flow Rail distinguishes disconnected data from available Paper action", () => {
  const { dom, document } = mountRail("disconnected");
  const observe = document.querySelector('[data-decision-step="observe"]');
  observe.click();

  const freshness = document.querySelector('[data-decision-freshness="observe"]');
  assert.equal(freshness.dataset.state, "stale");
  assert.equal(freshness.textContent, "연결 끊김 · 데이터 주의");
  assert.equal(document.querySelector('[data-decision-value="action"]').textContent, "Paper 주문 대기");
  assert.equal(document.querySelector('[data-decision-freshness="action"]').dataset.state, "stale");
  assert.equal(document.querySelector('[data-decision-freshness="risk"]').dataset.state, "restricted");
  dom.window.close();
});

test("Decision Flow Rail remains safe in a reduced DOM/runtime harness", () => {
  const dom = new JSDOM(html, { url: "http://localhost/", pretendToBeVisual: true, runScripts: "dangerously" });
  const { document } = dom.window;
  dom.window.MutationObserver = undefined;
  const secondScript = document.createElement("script");
  secondScript.textContent = railSource;
  assert.doesNotThrow(() => document.body.append(secondScript));
  assert.equal(document.querySelectorAll("[data-decision-flow-rail]").length, 1);
  dom.window.close();
});

test("application state mount wires the rail through the production browser path", () => {
  const dom = new JSDOM(html, { url: "http://localhost/", pretendToBeVisual: true, runScripts: "dangerously" });
  const { window } = dom;
  window.NUSAApplicationState = { mount() {} };
  const script = window.document.createElement("script");
  script.textContent = mountSource;
  window.document.body.append(script);

  const railScript = window.document.querySelector('script[src="decision-flow-rail.js"]');
  assert.ok(railScript);
  assert.equal(railScript.src, "http://localhost/decision-flow-rail.js");
  dom.window.close();
});

test("Decision Flow Rail is readable at mobile widths and preserves presentation-only mounting guards", () => {
  assert.match(railCss, /\.decision-flow-rail__value[^}]*overflow-wrap:\s*anywhere/);
  assert.match(railCss, /\.decision-flow-rail__freshness[^}]*white-space:\s*normal/);
  assert.doesNotMatch(railCss, /decision-flow-rail__value[^}]*white-space:\s*nowrap/);
  assert.doesNotMatch(railCss, /decision-flow-rail__freshness[^}]*white-space:\s*nowrap/);
  assert.match(railCss, /@media\s*\(max-width:560px\)/);
  assert.match(railCss, /min-height:\s*78px/);
  assert.match(railCss, /:focus-visible/);
  assert.match(railCss, /prefers-reduced-motion/);
  assert.match(mountSource, /typeof document\.querySelector === "function"/);
  assert.match(mountSource, /typeof document\.createElement === "function"/);
  assert.match(mountSource, /document\.body/);
});
