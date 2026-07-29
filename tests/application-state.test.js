const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const states = require("../apps/desktop/renderer/application-state.js");

const root = path.resolve(__dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("decision states take precedence and preserve abstention", () => {
  assert.equal(states.resolveState({ decisionState: "NO_QUORUM", online: true, hasPrice: true }), "NO_QUORUM");
  assert.equal(states.resolveState({ decisionState: "ABSTAIN", online: true, hasPrice: true }), "ABSTAIN");
  assert.equal(states.resolveState({ decisionState: "DISAGREEMENT", online: true, hasPrice: true }), "DISAGREEMENT");
  assert.equal(states.resolveState({ decisionState: "SAFETY_BLOCKED", online: true, hasPrice: true }), "SAFETY_BLOCKED");
  assert.equal(states.resolveState({ decisionState: "APPROVED_PAPER_ACTION", online: true, hasPrice: true }), "APPROVED_PAPER_ACTION");
});

test("operational state resolution fails closed", () => {
  assert.equal(states.resolveState({ loading: true }), "LOADING");
  assert.equal(states.resolveState({ online: false }), "OFFLINE");
  assert.equal(states.resolveState({ online: true, connectionStatus: "reconnecting", hasPrice: true }), "RECONNECTING");
  assert.equal(states.resolveState({ online: true, connectionStatus: "connected", hasPrice: false }), "NO_DATA");
  assert.equal(states.resolveState({ online: true, connectionStatus: "connected", hasPrice: true, strategyStatus: "STOPPED", autoTradeEnabled: true }), "STRATEGY_STOPPED");
  assert.equal(states.resolveState({ online: true, connectionStatus: "connected", hasPrice: true, strategyStatus: "RUNNING", autoTradeEnabled: false }), "PAPER_DISABLED");
  assert.equal(states.resolveState({ online: true, connectionStatus: "connected", hasPrice: true, strategyStatus: "RUNNING", autoTradeEnabled: true }), "READY");
});

test("state catalog uses honest non-profit language", () => {
  const copy = JSON.stringify(states.catalog);
  assert.doesNotMatch(copy, /수익 보장|승률|profit probability/i);
  assert.match(copy, /거래하지 않고/);
  assert.match(copy, /Paper/);
});

test("renderer contract exposes an accessible live status surface", () => {
  const html = read("apps/desktop/renderer/index.html");
  const script = read("apps/desktop/renderer/application-state.js");
  assert.match(html, /id="application-state"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="application-state-title"/);
  assert.match(html, /id="application-state-description"/);
  assert.match(html, /id="application-state-action"/);
  assert.match(script, /MutationObserver/);
  assert.match(script, /addEventListener\("offline"/);
  assert.match(script, /addEventListener\("online"/);
  assert.match(script, /loadingTimeoutMs/);
});

test("loading fallback resolves to a non-permissive state when no data arrives", () => {
  const timers = [];
  const nodes = new Map([
    ["application-state", { dataset: {} }],
    ["application-state-title", { textContent: "" }],
    ["application-state-description", { textContent: "" }],
    ["application-state-action", { textContent: "" }],
    ["price", { textContent: "?쒖꽭 ?湲?以?" }],
    ["status", { textContent: "" }],
    ["strategy-status", { textContent: "STOPPED" }],
    ["auto-trade", { checked: false, addEventListener() {} }]
  ]);
  const document = { body: { dataset: {} }, getElementById: (id) => nodes.get(id) };
  const windowObject = {
    navigator: { onLine: true },
    MutationObserver: class { observe() {} disconnect() {} },
    addEventListener() {},
    setTimeout: (callback) => { timers.push(callback); return 1; },
    clearTimeout() {}
  };
  const mounted = states.mount(document, windowObject, { loadingTimeoutMs: 1 });
  timers[0]();
  assert.notEqual(nodes.get("application-state").dataset.state, "LOADING");
  assert.notEqual(nodes.get("application-state").dataset.tone, "positive");
  mounted.disconnect();
});
