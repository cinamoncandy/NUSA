const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildPaperChaosRecoveryReceipt,
  buildPaperChaosRecoveryReport,
  verifyPaperChaosRecoveryReceipt,
} = require("../dist/apps/cloud/src/paperChaosRecovery.js");
const { PaperTradingExecutionLoop } = require("../dist/apps/cloud/src/paperTradingExecutionLoop.js");
const { PaperAutoLearningRuntime } = require("../dist/apps/cloud/src/paperAutoLearningRuntime.js");

const state = (overrides = {}) => ({
  runtimeStatus: "RUNNING",
  persistenceStatus: "AVAILABLE",
  upstreamStatus: "HEALTHY",
  chronologyStatus: "VALID",
  reconciliationStatus: "MATCH",
  orderIds: ["order-1"],
  fillIds: ["fill-1"],
  observedAt: 2_000,
  ...overrides,
});

const drill = (scenario, overrides = {}) => ({
  schemaVersion: 1,
  drillId: `drill-${scenario.toLowerCase()}`,
  scenario,
  triggerObserved: true,
  before: state(),
  after: state({ observedAt: 2_001, ...overrides }),
});

const healthy = () => ({ killSwitchActive: false, tradingAllowed: true, overallHealth: "HEALTHY" });
const buyDecision = Object.freeze({ symbol: "KRW-BTC", action: "BUY", confidence: 0.8, risk: "LOW", allocation: 0.5, leverage: 1, score: 0.8, reasons: Object.freeze(["deterministic PAPER drill"]), decidedAt: 1_000 });
const observation = (now, price = 100, observedAt = now) => ({ market: "KRW-BTC", price, observedAt, now, trusted: true });
const observedState = (snapshot, overrides = {}) => ({
  runtimeStatus: "RUNNING",
  persistenceStatus: "AVAILABLE",
  upstreamStatus: "HEALTHY",
  chronologyStatus: "VALID",
  reconciliationStatus: "MATCH",
  orderIds: snapshot.account.orders.map((order) => order.id),
  fillIds: snapshot.account.fills.map((fill) => fill.id),
  observedAt: snapshot.account.updatedAt,
  ...overrides,
});
const paperRuntime = (options = {}) => {
  const execution = options.execution ?? new PaperTradingExecutionLoop({ initialCapital: 1_000, feeRate: 0, repository: options.repository });
  const instance = new PaperAutoLearningRuntime({ execution, decisions: () => [buyDecision], control: options.control ?? healthy, maxObservationAgeMs: 30_000 });
  return { execution, instance };
};

test("process restart receipt proves state identity is preserved and recovery is deterministic", () => {
  const receipt = buildPaperChaosRecoveryReceipt(drill("PROCESS_RESTART"));
  assert.equal(receipt.status, "PASS");
  assert.equal(receipt.resolution, "RECOVERED");
  assert.equal(receipt.noMutation, true);
  assert.match(receipt.evidenceSha256, /^[a-f0-9]{64}$/);
  assert.equal(verifyPaperChaosRecoveryReceipt(receipt).evidenceSha256, receipt.evidenceSha256);
});

test("stale, paused, outage, clock, corruption and reconciliation scenarios pass only with explicit fail-closed state", () => {
  const cases = [
    ["STALE_FEED", { upstreamStatus: "STALE", runtimeStatus: "ERROR" }],
    ["PAUSED_FEED", { runtimeStatus: "PAUSED" }],
    ["PERSISTENCE_WRITE_INTERRUPTION", { persistenceStatus: "INTERRUPTED", runtimeStatus: "ERROR" }],
    ["PERSISTENCE_READ_CORRUPTION", { persistenceStatus: "CORRUPTED", runtimeStatus: "HALTED" }],
    ["CLOCK_REGRESSION", { chronologyStatus: "REGRESSED", runtimeStatus: "ERROR" }],
    ["UPSTREAM_OUTAGE", { upstreamStatus: "DOWN", runtimeStatus: "HALTED" }],
    ["RECONCILIATION_MISMATCH", { reconciliationStatus: "MISMATCH", runtimeStatus: "HALTED" }],
  ];
  for (const [scenario, overrides] of cases) {
    const receipt = buildPaperChaosRecoveryReceipt(drill(scenario, overrides));
    assert.equal(receipt.status, "PASS", scenario);
    assert.equal(receipt.noMutation, true, scenario);
    assert.equal(receipt.resolution, scenario === "PAUSED_FEED" ? "NO_MUTATION" : "HALTED", scenario);
  }
});

test("duplicate replay is accepted only when order and fill identity/counts do not change", () => {
  const pass = buildPaperChaosRecoveryReceipt(drill("DUPLICATE_REPLAY"));
  assert.equal(pass.status, "PASS");
  const failed = buildPaperChaosRecoveryReceipt(drill("DUPLICATE_REPLAY", { fillIds: ["fill-1", "fill-2"] }));
  assert.equal(failed.status, "FAIL");
  assert.equal(failed.noMutation, false);
});

test("malformed or unobserved drills cannot become evidence", () => {
  assert.throws(() => buildPaperChaosRecoveryReceipt({ ...drill("STALE_FEED", { upstreamStatus: "HEALTHY", runtimeStatus: "RUNNING" }), triggerObserved: false }), /TRIGGER_NOT_OBSERVED/);
  assert.throws(() => buildPaperChaosRecoveryReceipt(drill("CLOCK_REGRESSION", { fillIds: ["fill-1", "fill-1"], chronologyStatus: "REGRESSED", runtimeStatus: "ERROR" })), /identities must be unique/);
  const receipt = buildPaperChaosRecoveryReceipt(drill("UPSTREAM_OUTAGE", { upstreamStatus: "DOWN", runtimeStatus: "HALTED" }));
  assert.throws(() => verifyPaperChaosRecoveryReceipt({ ...receipt, reasonCode: "PAPER_UPSTREAM_OUTAGE_HALTED" + "-tampered" }), /INTEGRITY_FAILED/);
});

test("report ordering and bounded aggregation are deterministic", () => {
  const a = buildPaperChaosRecoveryReceipt(drill("STALE_FEED", { upstreamStatus: "STALE", runtimeStatus: "ERROR" }));
  const b = buildPaperChaosRecoveryReceipt(drill("PROCESS_RESTART"));
  const first = buildPaperChaosRecoveryReport([a, b], 3_000);
  const second = buildPaperChaosRecoveryReport([b, a], 3_000);
  assert.deepEqual(first, second);
  assert.equal(first.status, "PASS");
  assert.equal(first.haltedCount, 1);
  assert.throws(() => buildPaperChaosRecoveryReport(Array.from({ length: 33 }, (_, index) => ({ ...a, drillId: `drill-${index}` })), 3_000), /RECEIPT_LIMIT_INVALID/);
});

test("chaos receipts are produced from actual PAPER runtime boundaries, not synthetic accounting", () => {
  const receipts = [];

  const restartPersistence = { saved: undefined, save(state) { this.saved = state; }, loadLatest() { return this.saved; }, clear() {} };
  const first = paperRuntime({ repository: restartPersistence });
  const firstSnapshot = first.instance.onMarketObservation(observation(1_000));
  assert.equal(firstSnapshot.lastExecutionStatus, "FILLED");
  const restarted = paperRuntime({ repository: restartPersistence });
  const restartSnapshot = restarted.instance.snapshot();
  receipts.push(buildPaperChaosRecoveryReceipt({ schemaVersion: 1, drillId: "runtime-process-restart", scenario: "PROCESS_RESTART", triggerObserved: true, before: observedState(firstSnapshot), after: observedState(restartSnapshot, { observedAt: 1_001 }) }));

  const stale = paperRuntime();
  const staleBefore = stale.instance.snapshot();
  const staleAfter = stale.instance.onMarketObservation(observation(31_000, 100, 1_000));
  assert.equal(staleAfter.status, "ERROR");
  receipts.push(buildPaperChaosRecoveryReceipt({ schemaVersion: 1, drillId: "runtime-stale-feed", scenario: "STALE_FEED", triggerObserved: true, before: observedState(staleBefore), after: observedState(staleAfter, { runtimeStatus: "ERROR", upstreamStatus: "STALE", observedAt: 31_000 }) }));

  const paused = paperRuntime();
  paused.instance.pause("PAPER_FEED_PAUSED");
  const pausedBefore = paused.instance.snapshot();
  const pausedAfter = paused.instance.onMarketObservation(observation(1_000));
  assert.equal(pausedAfter.status, "PAUSED");
  receipts.push(buildPaperChaosRecoveryReceipt({ schemaVersion: 1, drillId: "runtime-paused-feed", scenario: "PAUSED_FEED", triggerObserved: true, before: observedState(pausedBefore), after: observedState(pausedAfter, { runtimeStatus: "PAUSED", upstreamStatus: "STALE", observedAt: 1_000 }) }));

  const duplicate = paperRuntime();
  const filled = duplicate.instance.onMarketObservation(observation(1_000));
  const duplicateAfter = duplicate.instance.onMarketObservation(observation(1_000));
  assert.equal(duplicateAfter.lastExecutionStatus, "DUPLICATE");
  receipts.push(buildPaperChaosRecoveryReceipt({ schemaVersion: 1, drillId: "runtime-duplicate-replay", scenario: "DUPLICATE_REPLAY", triggerObserved: true, before: observedState(filled), after: observedState(duplicateAfter, { observedAt: 1_001 }) }));

  const interruptedRepository = { save() { throw new Error("injected write interruption"); }, loadLatest() { return undefined; }, clear() {} };
  const interrupted = paperRuntime({ repository: interruptedRepository });
  const interruptedBefore = interrupted.instance.snapshot();
  const interruptedAfter = interrupted.instance.onMarketObservation(observation(1_000));
  assert.equal(interruptedAfter.status, "ERROR");
  assert.equal(interruptedAfter.lastExecutionStatus, "FAILED");
  receipts.push(buildPaperChaosRecoveryReceipt({ schemaVersion: 1, drillId: "runtime-write-interruption", scenario: "PERSISTENCE_WRITE_INTERRUPTION", triggerObserved: true, before: observedState(interruptedBefore), after: observedState(interruptedAfter, { runtimeStatus: "ERROR", persistenceStatus: "INTERRUPTED", observedAt: 1_000 }) }));

  let health = healthy();
  const outage = paperRuntime({ control: () => health });
  health = { killSwitchActive: false, tradingAllowed: false, overallHealth: "DOWN" };
  const outageBefore = outage.instance.snapshot();
  const outageAfter = outage.instance.onMarketObservation(observation(1_000));
  assert.equal(outageAfter.status, "HALTED");
  receipts.push(buildPaperChaosRecoveryReceipt({ schemaVersion: 1, drillId: "runtime-upstream-outage", scenario: "UPSTREAM_OUTAGE", triggerObserved: true, before: observedState(outageBefore), after: observedState(outageAfter, { runtimeStatus: "HALTED", upstreamStatus: "DOWN", observedAt: 1_000 }) }));

  const clock = paperRuntime();
  const clockBefore = clock.instance.onMarketObservation(observation(2_000));
  const clockAfter = clock.instance.onMarketObservation(observation(1_000, 110));
  assert.equal(clockAfter.lastError, "PAPER_MARKET_CHRONOLOGY_REGRESSION");
  receipts.push(buildPaperChaosRecoveryReceipt({ schemaVersion: 1, drillId: "runtime-clock-regression", scenario: "CLOCK_REGRESSION", triggerObserved: true, before: observedState(clockBefore), after: observedState(clockAfter, { runtimeStatus: "ERROR", chronologyStatus: "REGRESSED", observedAt: 2_000 }) }));

  assert.equal(buildPaperChaosRecoveryReport(receipts, 32_000).status, "PASS");
  assert.equal(receipts.length, 7);
});

test("corrupt persistence reads and reconciliation mismatches halt the real PAPER constructor", () => {
  const corruptRepository = { save() {}, loadLatest() { throw new Error("corrupt paper row"); }, clear() {} };
  assert.throws(() => new PaperTradingExecutionLoop({ initialCapital: 1_000, repository: corruptRepository }), /corrupt paper row/);
  const corruptState = state({ orderIds: [], fillIds: [] });
  const corrupt = buildPaperChaosRecoveryReceipt({ ...drill("PERSISTENCE_READ_CORRUPTION", { runtimeStatus: "HALTED", persistenceStatus: "CORRUPTED", orderIds: [], fillIds: [] }), before: corruptState });
  assert.equal(corrupt.status, "PASS");

  const mismatchedState = {
    version: 1, initialCapital: 1_000, cash: 1_000, equity: 1_000, realizedPnL: 0, unrealizedPnL: 0,
    positions: [],
    orders: [{ id: "order-1", idempotencyKey: "key-1", market: "KRW-BTC", side: "BUY", quantity: 1, price: 100, fee: 0, status: "FILLED", createdAt: 1_000, filledAt: 1_000 }],
    fills: [], processedIdempotencyKeys: ["key-1"], updatedAt: 1_000,
  };
  const mismatchRepository = { save() {}, loadLatest() { return mismatchedState; }, clear() {} };
  assert.throws(() => new PaperTradingExecutionLoop({ initialCapital: 1_000, repository: mismatchRepository }), /reconciliation mismatch/);
  const mismatchState = state({ orderIds: [], fillIds: [] });
  const mismatch = buildPaperChaosRecoveryReceipt({ ...drill("RECONCILIATION_MISMATCH", { runtimeStatus: "HALTED", reconciliationStatus: "MISMATCH", orderIds: [], fillIds: [] }), before: mismatchState });
  assert.equal(mismatch.status, "PASS");
});
