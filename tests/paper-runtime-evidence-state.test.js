const test = require("node:test");
const assert = require("node:assert/strict");
const { PaperRuntimeEvidenceState } = require("../dist/apps/desktop/src/paper/paperRuntimeEvidenceState.js");

test("records WebSocket recovery only after an observed reconnect cycle", () => {
  const state = new PaperRuntimeEvidenceState();
  assert.equal(state.observeMarketStatus("connected"), undefined);
  assert.equal(state.observeMarketStatus("error: network"), undefined);
  assert.equal(state.observeMarketStatus("reconnecting-in-1000ms"), undefined);
  assert.equal(state.observeMarketStatus("connecting"), undefined);
  assert.equal(state.observeMarketStatus("connected"), "WEBSOCKET_DISCONNECT_RECOVERED");
  assert.equal(state.observeMarketStatus("connected"), undefined);
});

test("records at most one verified reconnect scenario per Paper session", () => {
  const state = new PaperRuntimeEvidenceState();
  state.observeMarketStatus("reconnecting-in-1000ms");
  assert.equal(state.observeMarketStatus("connected"), "WEBSOCKET_DISCONNECT_RECOVERED");
  state.observeMarketStatus("reconnecting-in-2000ms");
  assert.equal(state.observeMarketStatus("connected"), undefined);
});
