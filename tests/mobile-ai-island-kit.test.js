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

const ok = { stale: false, blocked: false, hasHeartbeat: true, halted: false, dim: false, hasDecisionCount: true };

test("the status chip is lit only when the island itself is live", () => {
  assert.deepEqual(m.nowStatusChip(ok), { text: "PAPER · 모의 운영", live: true });
  assert.equal(m.nowStatusChip({ ...ok, hasHeartbeat: false }).live, false);
  assert.equal(m.nowStatusChip({ ...ok, blocked: true }).live, false);
  assert.deepEqual(m.nowStatusChip({ ...ok, stale: true, blocked: true }), { text: "PAPER · 지난 값", live: false });
  assert.deepEqual(m.nowStatusChip({ ...ok, halted: true }), { text: "PAPER · 멈춤", live: false });
  assert.deepEqual(m.nowStatusChip({ ...ok, dim: true }), { text: "PAPER · 확인 중", live: false });
  assert.equal(m.nowStatusChip({ ...ok, hasDecisionCount: false }).live, false);
});

test("the status chip says PAPER in every combination and is lit in exactly one", () => {
  let lit = 0;
  for (let bits = 0; bits < 64; bits += 1) {
    const [stale, blocked, hasHeartbeat, halted, dim, hasDecisionCount] = [0, 1, 2, 3, 4, 5].map((i) => Boolean(bits & (1 << i)));
    const chip = m.nowStatusChip({ stale, blocked, hasHeartbeat, halted, dim, hasDecisionCount });
    assert.match(chip.text, /^PAPER/);
    if (chip.live) lit += 1;
  }
  assert.equal(lit, 1);
});
