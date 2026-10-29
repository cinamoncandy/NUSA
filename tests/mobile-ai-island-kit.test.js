"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const m = require("../apps/mobile/src/stageTraceModel");

test("the stage trace marks stages before the broken one as passed and the rest as waiting", () => {
  assert.deepEqual(m.buildStageTrace("ORDER").map((s) => s.state), ["PASSED", "PASSED", "BROKEN", "AHEAD"]);
  assert.deepEqual(m.buildStageTrace("MARKET").map((s) => s.state), ["BROKEN", "AHEAD", "AHEAD", "AHEAD"]);
  assert.deepEqual(m.buildStageTrace("FILL").map((s) => s.label), ["시세", "판단", "주문", "체결"]);
});

test("without a real first broken stage there is no trace, so nothing is claimed as passed", () => {
  assert.equal(m.buildStageTrace(null), null);
  assert.equal(m.buildStageTrace(undefined), null);
  assert.equal(m.buildStageTrace("SOMETHING"), null);
  assert.equal(m.stageTraceIndex(null), null);
  assert.equal(m.stageTraceIndex("ORDER"), "03 / 04");
});

test("the status chip is lit only for a fresh, unblocked snapshot with a heartbeat", () => {
  assert.deepEqual(m.nowStatusChip({ stale: false, blocked: false, hasHeartbeat: true }), { text: "PAPER · 모의 운영", live: true });
  assert.equal(m.nowStatusChip({ stale: false, blocked: false, hasHeartbeat: false }).live, false);
  assert.equal(m.nowStatusChip({ stale: false, blocked: true, hasHeartbeat: true }).live, false);
  assert.deepEqual(m.nowStatusChip({ stale: true, blocked: true, hasHeartbeat: true }), { text: "PAPER · 지난 값", live: false });
  for (const s of [true, false]) for (const b of [true, false]) for (const h of [true, false]) assert.match(m.nowStatusChip({ stale: s, blocked: b, hasHeartbeat: h }).text, /^PAPER/);
});
