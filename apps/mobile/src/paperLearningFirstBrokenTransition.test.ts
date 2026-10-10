import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPaperLearningScreen, type PaperLearningUiEvent } from "./paperLearningScreen";

const event = (overrides: Partial<PaperLearningUiEvent>): PaperLearningUiEvent => ({
  id: "event-1",
  cycleId: "cycle-1",
  stage: "MARKET_DATA",
  occurredAt: 1,
  market: "KRW-BTC",
  status: "PASS",
  ...overrides,
});

describe("PAPER first broken transition", () => {
  it("reports the earliest explicit broken transition without inferring missing stages", () => {
    const state = buildPaperLearningScreen([
      event({ id: "market", stage: "MARKET_DATA", occurredAt: 1, status: "PASS" }),
      event({ id: "signal", stage: "SIGNAL", occurredAt: 2, status: "PASS" }),
      event({ id: "risk", stage: "RISK", occurredAt: 3, status: "FAIL", reason: "RISK_BUDGET_EXCEEDED" }),
      event({ id: "error", stage: "ERROR", occurredAt: 4, status: "FAIL", reason: "later failure" }),
    ], "RUNNING", "SERVER_STREAM");
    assert.deepEqual(state.firstBrokenTransition, {
      from: "SIGNAL",
      to: "RISK",
      reason: "RISK_BUDGET_EXCEEDED",
      occurredAt: 3,
    });
  });

  it("does not fabricate a broken transition when no explicit failure is observed", () => {
    const state = buildPaperLearningScreen([
      event({ id: "market", stage: "MARKET_DATA", occurredAt: 1, status: "PASS" }),
      event({ id: "signal", stage: "SIGNAL", occurredAt: 2, status: "PASS" }),
    ], "RUNNING", "SERVER_STREAM");
    assert.equal(state.firstBrokenTransition, null);
  });
});
