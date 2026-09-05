import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PaperLearningEventRecorder } from "./paperLearningObservability";

const base = {
  cycleId: "paper:KRW-BTC:1788600000000",
  occurredAt: 1_788_600_000_000,
  market: "KRW-BTC",
} as const;

describe("PaperLearningEventRecorder truth normalization", () => {
  it("records valid non-actionable decisions as non-actionable instead of unsupported", () => {
    const recorder = new PaperLearningEventRecorder({ persistencePath: ":memory:" });
    const event = recorder.record({
      ...base,
      stage: "DECISION",
      status: "PASS",
      reason: "UNSUPPORTED_ACTION:WAIT",
      decision: { symbol: "KRW-BTC", action: "WAIT", allocation: 0, confidence: 0.91, decidedAt: base.occurredAt },
    });
    assert.equal(event.reason, "NO_ACTIONABLE_PAPER_DECISION:WAIT");
  });

  it("marks permission as not evaluated when the same cycle has no actionable decision", () => {
    const recorder = new PaperLearningEventRecorder({ persistencePath: ":memory:" });
    recorder.record({
      ...base,
      stage: "DECISION",
      status: "PASS",
      reason: "UNSUPPORTED_ACTION:HOLD",
      decision: { symbol: "KRW-BTC", action: "HOLD", allocation: 0, confidence: 0.78, decidedAt: base.occurredAt },
    });
    const permission = recorder.record({
      ...base,
      stage: "PERMISSION",
      status: "SKIP",
      reason: "NO_CANONICAL_TRADE_PERMISSION_EVIDENCE",
    });
    assert.equal(permission.reason, "NOT_EVALUATED_NO_ACTIONABLE_DECISION");
  });

  it("does not hide missing permission evidence for an actionable BUY decision", () => {
    const recorder = new PaperLearningEventRecorder({ persistencePath: ":memory:" });
    recorder.record({
      ...base,
      stage: "DECISION",
      status: "PASS",
      decision: { symbol: "KRW-BTC", action: "BUY", allocation: 0.1, confidence: 0.8, decidedAt: base.occurredAt },
    });
    const permission = recorder.record({
      ...base,
      stage: "PERMISSION",
      status: "SKIP",
      reason: "NO_CANONICAL_TRADE_PERMISSION_EVIDENCE",
    });
    assert.equal(permission.reason, "NO_CANONICAL_TRADE_PERMISSION_EVIDENCE");
  });
});
