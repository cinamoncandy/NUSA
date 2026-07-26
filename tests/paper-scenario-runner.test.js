const test = require("node:test");
const assert = require("node:assert/strict");
const { runPaperScenario, validateFixture } = require("../scripts/lib/paper-scenario-runner.js");

const baseFixture = () => ({
  schemaVersion: 1,
  id: "TEST_SCENARIO",
  initialCash: 10_000_000,
  market: "KRW-BTC",
  feeRate: 0.0005,
  events: [
    { id: "EVT-001", type: "MANUAL_ORDER", side: "BUY", quantity: 10, price: 100_000, timestamp: "2026-01-01T00:00:01.000Z" }
  ],
  expected: { finalCash: 10_000_000 - (10 * 100_000 + 10 * 100_000 * 0.0005), positionQuantity: 10, averageEntryPrice: 100_000, realizedPnl: 0, totalFees: 500, orderCount: 1 }
});

test("a well-formed single-BUY fixture passes with matching production and independent-verifier results", () => {
  const result = runPaperScenario(baseFixture());
  assert.equal(result.status, "PASS", JSON.stringify(result.failures));
  assert.equal(result.eventsProcessed, 1);
  assert.equal(result.expectedComparison.status, "PASS");
  assert.equal(result.independentVerification.status, "PASS");
});

test("running the same fixture twice produces the same PASS/FAIL status and the same expectedComparison.actual", () => {
  const first = runPaperScenario(baseFixture());
  const second = runPaperScenario(baseFixture());
  assert.equal(first.status, second.status);
  assert.deepEqual(first.expectedComparison.actual, second.expectedComparison.actual);
});

test("missing schemaVersion is rejected before any event runs", () => {
  const fixture = baseFixture();
  delete fixture.schemaVersion;
  const result = runPaperScenario(fixture);
  assert.equal(result.status, "FAIL");
  assert.equal(result.eventsProcessed, 0);
  assert.ok(result.failures.some((message) => message.includes("schemaVersion")));
});

test("a negative price is rejected by fixture validation", () => {
  const fixture = baseFixture();
  fixture.events[0].price = -1;
  const result = runPaperScenario(fixture);
  assert.equal(result.status, "FAIL");
  assert.equal(result.eventsProcessed, 0);
});

test("an unknown event type is rejected by fixture validation", () => {
  const fixture = baseFixture();
  fixture.events.push({ id: "EVT-BAD", type: "SOMETHING_ELSE" });
  const errors = validateFixture(fixture);
  assert.ok(errors.some((message) => message.includes("unknown type")));
});

test("a duplicate event id is rejected by fixture validation", () => {
  const fixture = baseFixture();
  fixture.events.push({ ...fixture.events[0] });
  const errors = validateFixture(fixture);
  assert.ok(errors.some((message) => message.includes("duplicate event id")));
});

test("an order that is expected to be rejected but instead fills is reported as a scenario failure", () => {
  const fixture = baseFixture();
  fixture.events[0].expectRejected = true;
  const result = runPaperScenario(fixture);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((message) => message.includes("expected rejection but the order filled")));
});

test("an order that unexpectedly gets rejected (insufficient cash) is reported as a scenario failure", () => {
  const fixture = baseFixture();
  fixture.events[0].quantity = 999_999; // far exceeds initialCash
  const result = runPaperScenario(fixture);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((message) => message.includes("unexpected rejection")));
});

test("an expected rejection with a matching reason substring passes", () => {
  const fixture = baseFixture();
  fixture.events[0].quantity = 999_999;
  fixture.events[0].expectRejected = true;
  fixture.events[0].expectedRejectReason = "insufficient paper cash";
  fixture.expected = { finalCash: fixture.initialCash, positionQuantity: 0, averageEntryPrice: 0, realizedPnl: 0, totalFees: 0, orderCount: 0 };
  const result = runPaperScenario(fixture);
  assert.equal(result.status, "PASS", JSON.stringify(result.failures));
});

test("INJECT_PERSISTENCE_FAILURE followed by a manual order rejects the order and RESTART recovers availability", () => {
  const fixture = baseFixture();
  fixture.events = [
    { id: "EVT-001", type: "MANUAL_ORDER", side: "BUY", quantity: 10, price: 100_000, timestamp: "2026-01-01T00:00:01.000Z" },
    { id: "EVT-002", type: "INJECT_PERSISTENCE_FAILURE" },
    { id: "EVT-003", type: "MANUAL_ORDER", side: "BUY", quantity: 1, price: 100_000, timestamp: "2026-01-01T00:00:02.000Z", expectRejected: true, expectedRejectReason: "PERSISTENCE" },
    { id: "EVT-004", type: "RESTART" },
    { id: "EVT-005", type: "MANUAL_ORDER", side: "SELL", quantity: 10, price: 100_000, timestamp: "2026-01-01T00:00:03.000Z" }
  ];
  // BUY 10@100,000: notional 1,000,000, fee 500, cash 10,000,000-1,000,500=8,999,500.
  // SELL 10@100,000 (after restart, same price): fee 500, pnl = (100,000-100,000)*10-500 = -500,
  // cash += (1,000,000-500) = 8,999,500+999,500 = 9,999,000.
  fixture.expected = { finalCash: 9_999_000, positionQuantity: 0, averageEntryPrice: 0, realizedPnl: -500, totalFees: 1_000, orderCount: 2 };
  const result = runPaperScenario(fixture);
  assert.equal(result.status, "PASS", JSON.stringify(result.failures));
  const restartEvent = result.events.find((event) => event.id === "EVT-004");
  assert.equal(restartEvent.after.controlStatus, "STOPPED");
});

test("the result is JSON-serializable", () => {
  const result = runPaperScenario(baseFixture());
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("the input fixture object is not mutated by the runner", () => {
  const fixture = baseFixture();
  const before = JSON.parse(JSON.stringify(fixture));
  runPaperScenario(fixture);
  assert.deepEqual(fixture, before);
});
