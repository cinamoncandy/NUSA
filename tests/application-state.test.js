const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const states = require("../apps/desktop/renderer/application-state.js");

const root = path.resolve(__dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

function createMountHarness(online = true) {
  const elements = {
    "application-state": { dataset: {} },
    "application-state-title": { textContent: "" },
    "application-state-description": { textContent: "" },
    "application-state-action": { textContent: "" },
    price: { textContent: "대기" },
    status: { textContent: "연결 상태 확인 중" },
    "strategy-status": { textContent: "STOPPED" },
    "auto-trade": { checked: false, addEventListener() {} }
  };
  const document = {
    body: { dataset: {} },
    getElementById(id) { return elements[id] ?? null; }
  };
  let timeoutCallback;
  let timeoutMs;
  let timerId = 0;
  const cleared = [];
  let observerDisconnected = false;
  class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe() {}
    disconnect() { observerDisconnected = true; }
  }
  const windowObject = {
    navigator: { onLine: online },
    MutationObserver,
    addEventListener() {},
    setTimeout(callback, ms) {
      timeoutCallback = callback;
      timeoutMs = ms;
      timerId += 1;
      return timerId;
    },
    clearTimeout(id) { cleared.push(id); }
  };
  return {
    document,
    elements,
    windowObject,
    fireTimeout() {
      assert.equal(typeof timeoutCallback, "function");
      const callback = timeoutCallback;
      timeoutCallback = undefined;
      callback();
    },
    timeoutMs: () => timeoutMs,
    cleared,
    observerDisconnected: () => observerDisconnected
  };
}

test("decision states render when current market state is verified", () => {
  const verified = { online: true, connectionStatus: "connected", hasPrice: true };
  assert.equal(states.resolveState({ ...verified, decisionState: "NO_QUORUM" }), "NO_QUORUM");
  assert.equal(states.resolveState({ ...verified, decisionState: "ABSTAIN" }), "ABSTAIN");
  assert.equal(states.resolveState({ ...verified, decisionState: "DISAGREEMENT" }), "DISAGREEMENT");
  assert.equal(states.resolveState({ ...verified, decisionState: "SAFETY_BLOCKED" }), "SAFETY_BLOCKED");
  assert.equal(states.resolveState({ ...verified, decisionState: "APPROVED_PAPER_ACTION" }), "APPROVED_PAPER_ACTION");
});

test("current operational blockers outrank stale non-safety decisions", () => {
  for (const decisionState of ["NO_QUORUM", "ABSTAIN", "DISAGREEMENT", "APPROVED_PAPER_ACTION"]) {
    assert.equal(states.resolveState({ decisionState, loading: true, online: true, hasPrice: true }), "LOADING");
    assert.equal(states.resolveState({ decisionState, online: false, hasPrice: true }), "OFFLINE");
    assert.equal(states.resolveState({ decisionState, online: true, connectionStatus: "reconnecting", hasPrice: true }), "RECONNECTING");
    assert.equal(states.resolveState({ decisionState, online: true, connectionStatus: "connected", hasPrice: false }), "NO_DATA");
  }
});

test("explicit safety block stays authoritative across operational degradation", () => {
  assert.equal(states.resolveState({ decisionState: "SAFETY_BLOCKED", loading: true }), "SAFETY_BLOCKED");
  assert.equal(states.resolveState({ decisionState: "SAFETY_BLOCKED", online: false }), "SAFETY_BLOCKED");
  assert.equal(states.resolveState({ decisionState: "SAFETY_BLOCKED", online: true, connectionStatus: "reconnecting", hasPrice: false }), "SAFETY_BLOCKED");
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

test("persistent bootstrap loading becomes truthful NO_DATA when the device is online", () => {
  const harness = createMountHarness(true);
  states.mount(harness.document, harness.windowObject, { loadingTimeoutMs: 25 });
  assert.equal(harness.elements["application-state"].dataset.state, "LOADING");
  assert.equal(harness.timeoutMs(), 25);
  harness.fireTimeout();
  assert.equal(harness.elements["application-state"].dataset.state, "NO_DATA");
});

test("persistent bootstrap loading becomes OFFLINE when the device is offline", () => {
  const harness = createMountHarness(false);
  states.mount(harness.document, harness.windowObject, { loadingTimeoutMs: 25 });
  assert.equal(harness.elements["application-state"].dataset.state, "LOADING");
  harness.fireTimeout();
  assert.equal(harness.elements["application-state"].dataset.state, "OFFLINE");
});

test("verified data clears the loading timer and disconnect also cleans it up", () => {
  const ready = createMountHarness(true);
  const controller = states.mount(ready.document, ready.windowObject, { loadingTimeoutMs: 25 });
  ready.elements.price.textContent = "100000000";
  ready.elements.status.textContent = "UPBIT 연결됨";
  ready.elements["strategy-status"].textContent = "RUNNING";
  ready.elements["auto-trade"].checked = true;
  controller.refresh();
  assert.equal(ready.elements["application-state"].dataset.state, "READY");
  assert.deepEqual(ready.cleared, [1]);

  const loading = createMountHarness(true);
  const loadingController = states.mount(loading.document, loading.windowObject, { loadingTimeoutMs: 25 });
  loadingController.disconnect();
  assert.equal(loading.observerDisconnected(), true);
  assert.deepEqual(loading.cleared, [1]);
});

test("loading timeout cannot override an explicit safety decision", () => {
  const harness = createMountHarness(true);
  harness.document.body.dataset.decisionState = "SAFETY_BLOCKED";
  states.mount(harness.document, harness.windowObject, { loadingTimeoutMs: 25 });
  assert.equal(harness.elements["application-state"].dataset.state, "SAFETY_BLOCKED");
  harness.fireTimeout();
  assert.equal(harness.elements["application-state"].dataset.state, "SAFETY_BLOCKED");
});

test("state catalog uses honest non-profit language", () => {
  const copy = JSON.stringify(states.catalog);
  assert.doesNotMatch(copy, /수익 보장|승률|profit probability/i);
  assert.match(copy, /거래하지 않고/);
  assert.match(copy, /Paper/);
});

test("canonical renderer exposes accessible live operational status surfaces", () => {
  const html = read("apps/desktop/renderer/index.html");
  const script = read("apps/desktop/renderer/application-state.js");
  assert.match(html, /data-simple-connection[^>]*aria-live="polite"/);
  assert.match(html, /data-simple-order-message[^>]*role="status"[^>]*aria-live="assertive"/);
  assert.match(html, /data-simple-settings-message[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(script, /MutationObserver/);
  assert.match(script, /addEventListener\("offline"/);
  assert.match(script, /addEventListener\("online"/);
});
