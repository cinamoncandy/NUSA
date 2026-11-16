"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { decide, classifyProbe } = require("../scripts/health-watch-decide.js");

const NOW = Date.parse("2026-11-14T12:00:00Z");
const good = (offsetMs = 0) => ({ httpStatus: 200, body: JSON.stringify({ ok: true, observedAt: new Date(NOW - offsetMs).toISOString() }) });

test("RUNNING expected: any non-answering probe is DOWN, an answering one is fine", () => {
  assert.equal(decide("RUNNING", good(), NOW).alert, "NONE");
  for (const probe of [{ httpStatus: 502, body: "" }, { httpStatus: 0, body: "" }, { httpStatus: 200, body: "not json" }, { httpStatus: 200, body: "{\"ok\":false}" }, { httpStatus: 200, body: "{\"ok\":true}" }, good(11 * 60 * 1000), good(-5 * 60 * 1000), null]) {
    assert.equal(decide("RUNNING", probe, NOW).alert, "DOWN", JSON.stringify(probe));
  }
});

test("STOPPED expected: an answering probe is UNEXPECTED_UP, silence and a stale answer are fine", () => {
  assert.equal(decide("STOPPED", good(), NOW).alert, "UNEXPECTED_UP");
  for (const probe of [{ httpStatus: 502, body: "" }, { httpStatus: 0, body: "" }, good(11 * 60 * 1000), null]) {
    assert.equal(decide("STOPPED", probe, NOW).alert, "NONE", JSON.stringify(probe));
  }
});

test("an unknown expected state is a configuration alarm, never silence", () => {
  for (const state of [undefined, "", "running", "UP", null, 1]) assert.equal(decide(state, good(), NOW).alert, "CONFIG_INVALID");
  assert.equal(classifyProbe(undefined, NOW).answering, false);
});

test("the committed config and workflow stay read-only and https", () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deploy", "health-watch.json"), "utf8"));
  assert.ok(["STOPPED", "RUNNING"].includes(config.expectedState));
  assert.match(config.healthUrl, /^https:\/\/[a-z0-9.-]+\/health$/);
  const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "health-watch.yml"), "utf8").replace(/\r\n/g, "\n");
  assert.match(workflow, /permissions:\n  contents: read\n  issues: write\n/);
  assert.doesNotMatch(workflow, /secrets\./);
  assert.doesNotMatch(workflow, /systemctl|ssh /);
  assert.doesNotMatch(workflow, /^\s*(pull_request|pull_request_target|workflow_run)\s*:/m);
  assert.match(workflow, /cron: "7,37 \* \* \* \*"/);
  // An unreadable or invalid config must end in a CONFIG_INVALID alarm, not in a step failure nobody reads.
  assert.match(workflow, /RESULT="CONFIG_INVALID unreadable_or_invalid_config"/);
  assert.match(workflow, /\|\| URL=""/);
  assert.match(workflow, /\|\| RESULT="CONFIG_INVALID unreadable_or_invalid_config"/);
});

const withRuntime = (runtime, offsetMs = 0) => ({ httpStatus: 200, body: JSON.stringify({ ok: true, observedAt: new Date(NOW - offsetMs).toISOString(), runtime }) });
const collectOnly = (over = {}) => ({ runMode: "COLLECT_ONLY", orderPathReady: false, paperOrderCount: 0, startedAt: NOW - 3 * 3600_000, lastMarketEventAt: NOW - 30_000, ...over });

test("expectedRunMode COLLECT_ONLY: the host must show the collect-only facts, and a missing fact is an alarm", () => {
  assert.deepEqual(decide("RUNNING", withRuntime(collectOnly()), NOW, "COLLECT_ONLY"), { alert: "NONE", reason: "MODE_FACTS_OK" });
  const cases = [
    [collectOnly({ runMode: "PAPER_ORDERS" }), "MODE_MISMATCH"],
    [collectOnly({ runMode: undefined }), "MODE_MISMATCH"],
    [collectOnly({ orderPathReady: true }), "ORDER_WHILE_NOT_GRANTED"],
    [collectOnly({ orderPathReady: undefined }), "ORDER_WHILE_NOT_GRANTED"],
    [collectOnly({ paperOrderCount: 1 }), "ORDER_WHILE_NOT_GRANTED"],
    [collectOnly({ paperOrderCount: undefined }), "ORDER_WHILE_NOT_GRANTED"],
    [collectOnly({ paperOrderCount: "0" }), "ORDER_WHILE_NOT_GRANTED"],
    [collectOnly({ lastMarketEventAt: NOW - 11 * 60 * 1000 }), "EVENTS_STALE"],
    [collectOnly({ lastMarketEventAt: NOW + 5 * 60 * 1000 }), "EVENTS_STALE"],
    [collectOnly({ lastMarketEventAt: null }), "EVENTS_STALE"],
    [undefined, "MODE_MISMATCH"],
    [null, "MODE_MISMATCH"],
  ];
  for (const [runtime, alert] of cases) assert.equal(decide("RUNNING", withRuntime(runtime), NOW, "COLLECT_ONLY").alert, alert, JSON.stringify(runtime));
  // A runtime that has just started (a release, a restart) may have seen no market event yet: a start, not a stall. Only for 15 minutes.
  for (const over of [{ startedAt: NOW - 60_000, lastMarketEventAt: null }, { startedAt: NOW - 14 * 60_000, lastMarketEventAt: NOW - 14 * 60_000 }]) assert.equal(decide("RUNNING", withRuntime(collectOnly(over)), NOW, "COLLECT_ONLY").alert, "NONE", JSON.stringify(over));
  for (const over of [{ startedAt: NOW - 16 * 60_000, lastMarketEventAt: null }, { startedAt: undefined, lastMarketEventAt: null }, { startedAt: NOW + 10 * 60_000, lastMarketEventAt: null }]) assert.equal(decide("RUNNING", withRuntime(collectOnly(over)), NOW, "COLLECT_ONLY").alert, "EVENTS_STALE", JSON.stringify(over));
  // The grace never excuses a wrong mode or an order.
  assert.equal(decide("RUNNING", withRuntime(collectOnly({ startedAt: NOW - 60_000, orderPathReady: true })), NOW, "COLLECT_ONLY").alert, "ORDER_WHILE_NOT_GRANTED");
  // A silent host is still DOWN first, and the mode facts never apply while the host is expected to be STOPPED.
  assert.equal(decide("RUNNING", { httpStatus: 502, body: "" }, NOW, "COLLECT_ONLY").alert, "DOWN");
  assert.equal(decide("STOPPED", withRuntime(collectOnly()), NOW, "COLLECT_ONLY").alert, "CONFIG_INVALID");
  for (const mode of ["PAPER_ORDERS", "collect_only", "", null, 1]) assert.equal(decide("RUNNING", withRuntime(collectOnly()), NOW, mode).alert, "CONFIG_INVALID", String(mode));
  // Without expectedRunMode the old behaviour is unchanged.
  assert.equal(decide("RUNNING", withRuntime(collectOnly({ orderPathReady: true })), NOW).alert, "NONE");
});

test("the workflow reports one issue per new alert kind, with fixed text", () => {
  const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "health-watch.yml"), "utf8").replace(/\r\n/g, "\n");
  for (const alert of ["MODE_MISMATCH", "ORDER_WHILE_NOT_GRANTED", "EVENTS_STALE"]) assert.match(workflow, new RegExp(alert));
  assert.doesNotMatch(workflow, /systemctl|ssh |secrets\./);
});
