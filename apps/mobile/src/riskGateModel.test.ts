import assert from "node:assert/strict";
import test from "node:test";
import { buildRiskGate } from "./riskGateModel";

test("the gate shows only when the server's loss limit stopped buying and decisions ran with no order", () => {
  const gate = buildRiskGate({ lossLimitState: "STOPPED", decisionCount: 3292, paperOrderCount: 0, buySignalCount: 482, buyBlockedCount: 482 });
  assert.ok(gate);
  assert.match(gate.headline, /위험 단계에서 멈춤/);
  assert.equal(gate.detail, "매수 신호 482번이 문 앞에서 기다려요");
  assert.equal(gate.waiting, 482);
  for (const state of ["WARNING", "DISABLED", null] as const) assert.equal(buildRiskGate({ lossLimitState: state, decisionCount: 10, paperOrderCount: 0 }), null);
  assert.equal(buildRiskGate({ lossLimitState: "STOPPED", decisionCount: 10, paperOrderCount: 2 }), null, "orders exist: not a gate story");
  assert.equal(buildRiskGate({ lossLimitState: "STOPPED", decisionCount: 0, paperOrderCount: 0 }), null);
  assert.equal(buildRiskGate({ lossLimitState: "STOPPED", decisionCount: null, paperOrderCount: 0 }), null);
});

test("unknown or malformed counters are never shown as zero", () => {
  const gate = buildRiskGate({ lossLimitState: "STOPPED", decisionCount: 50, paperOrderCount: 0, buySignalCount: "482", buyBlockedCount: -1 });
  assert.ok(gate);
  assert.equal(gate.waiting, null);
  assert.equal(gate.signals, null);
  assert.equal(gate.detail, "판단 50번 · 새 주문 0건");
});

test("the streak cells use the server's own count and limit, and nothing else", () => {
  const base = { lossLimitState: "STOPPED" as const, decisionCount: 3292, paperOrderCount: 0 };
  assert.deepEqual(buildRiskGate({ ...base, consecutiveLossCount: 3, maxConsecutiveLosses: 3 })?.streak, { count: 3, max: 3 });
  assert.equal(buildRiskGate({ ...base, consecutiveLossCount: 3, maxConsecutiveLosses: 3 })?.decisions, 3292);
  assert.equal(buildRiskGate({ ...base })?.streak, null, "missing values draw no cells");
  assert.equal(buildRiskGate({ ...base, consecutiveLossCount: "3", maxConsecutiveLosses: 3 })?.streak, null);
  assert.equal(buildRiskGate({ ...base, consecutiveLossCount: 2, maxConsecutiveLosses: 3 })?.streak, null, "below the limit is not a stop");
  assert.equal(buildRiskGate({ ...base, consecutiveLossCount: 99, maxConsecutiveLosses: 99 })?.streak, null, "implausible limit draws nothing");
});
