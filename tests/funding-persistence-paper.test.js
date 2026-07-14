const test = require("node:test");
const assert = require("node:assert/strict");
const {
  appendFundingPersistencePaperEvent,
  createFundingPersistenceChampionCandidateReport,
  createFundingPersistencePaperDailyReport,
  createFundingPersistencePaperLedger,
  replayFundingPersistencePaperLedger,
  verifyFundingPersistencePaperLedger
} = require("../dist/apps/cloud/src/alpha/funding/FundingPersistencePaper.js");

const at = (hour) => new Date(Date.UTC(2026, 0, 1, hour, 0, 0)).toISOString();
const event = (eventId, orderId, type, hour, overrides = {}) => ({
  eventId, orderId, type, occurredAt: at(hour), reason: `${type}-TEST`, ...overrides
});

const buildClosedLedger = () => {
  let ledger = createFundingPersistencePaperLedger(1, "BTCUSDT");
  ledger = appendFundingPersistencePaperEvent(ledger, event("E1", "O1", "ORDER_CREATED", 0, { quantity: 2 }));
  ledger = appendFundingPersistencePaperEvent(ledger, event("E2", "O1", "ORDER_QUEUED", 1));
  ledger = appendFundingPersistencePaperEvent(ledger, event("E3", "O1", "ORDER_ACCEPTED", 2));
  ledger = appendFundingPersistencePaperEvent(ledger, event("E4", "O1", "ORDER_PARTIALLY_FILLED", 3, { quantity: 1, price: 100, fee: 0.1, slippageCost: 0.05 }));
  ledger = appendFundingPersistencePaperEvent(ledger, event("E5", "O1", "ORDER_FILLED", 4, { quantity: 1, price: 102, fee: 0.1, slippageCost: 0.05 }));
  ledger = appendFundingPersistencePaperEvent(ledger, event("E6", "O1", "POSITION_CLOSED", 5, { realizedPnl: 10, fee: 0.2, slippageCost: 0.1 }));
  ledger = appendFundingPersistencePaperEvent(ledger, event("E7", "O1", "ORDER_ARCHIVED", 6));
  return ledger;
};

test("creates, verifies, replays, and freezes an append-only paper ledger", () => {
  const ledger = buildClosedLedger();
  verifyFundingPersistencePaperLedger(ledger);
  const first = replayFundingPersistencePaperLedger(ledger);
  const second = replayFundingPersistencePaperLedger(ledger);
  assert.deepEqual(first, second);
  assert.match(first.replayHash, /^[a-f0-9]{64}$/);
  assert.equal(first.orders[0].state, "ARCHIVED");
  assert.equal(first.orders[0].filledQuantity, 2);
  assert.equal(first.orders[0].averageFillPrice, 101);
  assert.ok(Object.isFrozen(ledger));
  assert.ok(Object.isFrozen(ledger.events));
  assert.ok(ledger.events.every(Object.isFrozen));
});

test("rejects duplicate events, missing orders, invalid transitions, and overfills", () => {
  let ledger = createFundingPersistencePaperLedger(1, "BTCUSDT");
  ledger = appendFundingPersistencePaperEvent(ledger, event("E1", "O1", "ORDER_CREATED", 0, { quantity: 1 }));
  assert.throws(() => appendFundingPersistencePaperEvent(ledger, event("E1", "O1", "ORDER_QUEUED", 1)), /duplicate event/);
  assert.throws(() => appendFundingPersistencePaperEvent(ledger, event("E2", "MISSING", "ORDER_ACCEPTED", 1)), /order does not exist/);
  assert.throws(() => appendFundingPersistencePaperEvent(ledger, event("E2", "O1", "ORDER_ACCEPTED", 1)), /invalid transition/);
  ledger = appendFundingPersistencePaperEvent(ledger, event("E2", "O1", "ORDER_QUEUED", 1));
  ledger = appendFundingPersistencePaperEvent(ledger, event("E3", "O1", "ORDER_ACCEPTED", 2));
  const accepted = ledger;
  assert.throws(() => appendFundingPersistencePaperEvent(accepted, event("E4", "O1", "ORDER_FILLED", 3, { quantity: 2, price: 100 })), /exceeds requested quantity/);
});

test("detects ledger tampering", () => {
  const ledger = buildClosedLedger();
  const corruptedEvent = Object.freeze({ ...ledger.events[0], reason: "TAMPERED" });
  const corrupted = Object.freeze({ ...ledger, events: Object.freeze([corruptedEvent, ...ledger.events.slice(1)]) });
  assert.throws(() => verifyFundingPersistencePaperLedger(corrupted), /contentHash mismatch|hash chain/);
});

test("creates deterministic daily paper reports", () => {
  const ledger = buildClosedLedger();
  const first = createFundingPersistencePaperDailyReport(ledger, "2026-01-01");
  const second = createFundingPersistencePaperDailyReport(ledger, "2026-01-01");
  assert.deepEqual(first, second);
  assert.equal(first.createdOrders, 1);
  assert.equal(first.filledOrders, 1);
  assert.equal(first.closedPositions, 1);
  assert.equal(first.grossRealizedPnl, 10);
  assert.equal(first.fees, 0.4);
  assert.equal(first.slippageCost, 0.2);
  assert.equal(first.netRealizedPnl, 9.4);
  assert.match(first.contentHash, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(first));
});

test("champion candidate remains policy-gated and never auto-promotes", () => {
  const ledger = buildClosedLedger();
  const daily = createFundingPersistencePaperDailyReport(ledger, "2026-01-01");
  const walkForward = Object.freeze({ aggregate: Object.freeze({ passed: true }) });
  const stress = Object.freeze({ passed: true });
  const pass = createFundingPersistenceChampionCandidateReport(
    ledger,
    [daily],
    walkForward,
    stress,
    "2026-01-02T00:00:00.000Z",
    { minimumPaperDays: 1, minimumClosedPositions: 1, minimumNetRealizedPnl: 0, maximumRejectedOrderRatio: 0.1, requireWalkForwardPass: true, requireStressPass: true }
  );
  assert.equal(pass.eligible, true);
  assert.deepEqual(pass.reasons, ["CHAMPION_CANDIDATE_POLICY_PASSED"]);
  const fail = createFundingPersistenceChampionCandidateReport(
    ledger,
    [daily],
    Object.freeze({ aggregate: Object.freeze({ passed: false }) }),
    Object.freeze({ passed: false }),
    "2026-01-02T00:00:00.000Z",
    { minimumPaperDays: 90, minimumClosedPositions: 5, minimumNetRealizedPnl: 100, maximumRejectedOrderRatio: 0, requireWalkForwardPass: true, requireStressPass: true }
  );
  assert.equal(fail.eligible, false);
  assert.ok(fail.reasons.includes("PAPER_DAYS_INSUFFICIENT"));
  assert.ok(fail.reasons.includes("WALK_FORWARD_NOT_PASSED"));
  assert.ok(fail.reasons.includes("STRESS_NOT_PASSED"));
});
