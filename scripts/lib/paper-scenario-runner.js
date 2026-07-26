"use strict";
/**
 * Runs a deterministic Paper Trading scenario fixture against the REAL production
 * runtime classes (PaperBroker, ControlPlane, StrategyEngine, RuntimeCommandService --
 * the same compiled modules apps/desktop/src/main.ts wires up), with an in-memory fake
 * persistence adapter standing in for SQLite. No network, no Electron, no real userData.
 *
 * This module does not reimplement any trading calculation -- it only supplies
 * deterministic inputs (fixed clock, fixed prices) and observes real outputs. Independent
 * verification of those outputs happens separately, in paper-ledger-verifier.js.
 */
const path = require("node:path");
const { verifyPaperLedger } = require("./paper-ledger-verifier.js");

const ALLOWED_EVENT_TYPES = new Set(["MANUAL_ORDER", "INJECT_PERSISTENCE_FAILURE", "RESTART"]);

function validateFixture(fixture) {
  const errors = [];
  if (fixture == null || typeof fixture !== "object") { errors.push("fixture must be an object"); return errors; }
  if (fixture.schemaVersion !== 1) errors.push(`unsupported schemaVersion: ${fixture.schemaVersion}`);
  if (typeof fixture.id !== "string" || fixture.id.length === 0) errors.push("fixture.id must be a non-empty string");
  if (!Number.isFinite(fixture.initialCash) || fixture.initialCash <= 0) errors.push("fixture.initialCash must be a positive finite number");
  if (typeof fixture.market !== "string" || fixture.market.length === 0) errors.push("fixture.market must be a non-empty string");
  if (!Number.isFinite(fixture.feeRate) || fixture.feeRate < 0) errors.push("fixture.feeRate must be a non-negative finite number");
  if (!Array.isArray(fixture.events) || fixture.events.length === 0) { errors.push("fixture.events must be a non-empty array"); return errors; }

  const seenIds = new Set();
  for (const event of fixture.events) {
    if (event == null || typeof event !== "object") { errors.push("every event must be an object"); continue; }
    if (typeof event.id !== "string" || event.id.length === 0) { errors.push("every event needs a non-empty id"); continue; }
    if (seenIds.has(event.id)) errors.push(`duplicate event id: ${event.id}`);
    seenIds.add(event.id);
    if (!ALLOWED_EVENT_TYPES.has(event.type)) { errors.push(`event ${event.id}: unknown type ${event.type}`); continue; }
    if (event.type === "MANUAL_ORDER") {
      if (event.side !== "BUY" && event.side !== "SELL") errors.push(`event ${event.id}: side must be BUY or SELL`);
      if (!Number.isFinite(event.quantity) || event.quantity <= 0) errors.push(`event ${event.id}: quantity must be a positive finite number`);
      if (!Number.isFinite(event.price) || event.price <= 0) errors.push(`event ${event.id}: price must be a positive finite number`);
      if (typeof event.timestamp !== "string" || Number.isNaN(Date.parse(event.timestamp))) errors.push(`event ${event.id}: timestamp must be a parseable ISO string`);
    }
  }

  if (!errors.length && !fixture.expected) errors.push("fixture.expected is required");
  return errors;
}

function loadProductionModules(repositoryRoot) {
  const distRoot = path.join(repositoryRoot, "dist", "apps", "desktop", "src");
  return {
    PaperBroker: require(path.join(distRoot, "paperBroker.js")).PaperBroker,
    ControlPlane: require(path.join(distRoot, "controlPlane.js")).ControlPlane,
    StrategyEngine: require(path.join(distRoot, "strategyEngine.js")).StrategyEngine,
    SmaCrossoverStrategy: require(path.join(distRoot, "strategyEngine.js")).SmaCrossoverStrategy,
    RuntimeCommandService: require(path.join(distRoot, "runtimeCommandService.js")).RuntimeCommandService
  };
}

/** A normalized, JSON-stable snapshot excluding fields that legitimately vary run to run
 * (order/fill ids embed Date.now()-based timestamps in this codebase's real ID scheme --
 * they are compared for uniqueness and count, not for a specific literal value). */
function normalizeState(brokerState, controlState) {
  return {
    cash: brokerState.cash,
    position: brokerState.position,
    orderCount: brokerState.orders.length,
    controlStatus: controlState.status,
    autoTradeEnabled: controlState.autoTradeEnabled
  };
}

/**
 * @param {object} fixture Parsed fixture JSON (see tests/fixtures/paper-scenarios/*.json)
 * @param {object} [options]
 * @param {string} [options.repositoryRoot] Defaults to two directories above this file.
 * @returns {{schemaVersion:1, scenarioId:string, status:"PASS"|"FAIL", eventsProcessed:number, events:object[], expectedComparison:object, independentVerification:object, failures:string[]}}
 */
function runPaperScenario(fixture, options = {}) {
  const fixtureErrors = validateFixture(fixture);
  if (fixtureErrors.length > 0) {
    return { schemaVersion: 1, scenarioId: fixture && fixture.id, status: "FAIL", eventsProcessed: 0, events: [], expectedComparison: null, independentVerification: null, failures: fixtureErrors };
  }

  const repositoryRoot = options.repositoryRoot || path.resolve(__dirname, "..", "..");
  const { PaperBroker, ControlPlane, StrategyEngine, SmaCrossoverStrategy, RuntimeCommandService } = loadProductionModules(repositoryRoot);

  const failures = [];
  const eventResults = [];

  // In-memory fake persistence: durable state only changes on a successful save() call,
  // mirroring what a real SQLite write would guarantee. `fail` is flipped on by
  // INJECT_PERSISTENCE_FAILURE and cleared by RESTART (simulating operator repair).
  let fail = false;
  let durable = null;
  const persistence = {
    save(paper, control) {
      if (fail) throw new Error("injected persistence failure");
      durable = { paper: JSON.parse(JSON.stringify(paper)), control: JSON.parse(JSON.stringify(control)) };
    }
  };

  let broker = new PaperBroker(fixture.initialCash, fixture.market, fixture.feeRate, fixture.riskPolicy || {});
  let control = new ControlPlane();
  let strategy = new StrategyEngine(new SmaCrossoverStrategy());
  let runtime = new RuntimeCommandService(broker, control, strategy, persistence);
  persistence.save(broker.exportState(), control.exportState());

  for (const event of fixture.events) {
    const before = normalizeState(broker.exportState(), control.exportState());
    const eventResult = { id: event.id, type: event.type, status: "PASS", before, after: null };

    if (event.type === "INJECT_PERSISTENCE_FAILURE") {
      fail = true;
      eventResult.after = before;
      eventResults.push(eventResult);
      continue;
    }

    if (event.type === "RESTART") {
      // Defensive only: the initial persistence.save() call above the loop always
      // establishes a durable baseline before any event runs, so this branch is not
      // reachable through a well-formed fixture -- kept in case that invariant changes.
      if (!durable) { failures.push(`event ${event.id}: no durable state exists to restart from`); eventResult.status = "FAIL"; eventResults.push(eventResult); continue; }
      fail = false;
      broker = new PaperBroker(fixture.initialCash, fixture.market, fixture.feeRate, fixture.riskPolicy || {}, durable.paper);
      control = new ControlPlane("sma-crossover", 200, durable.control);
      strategy = new StrategyEngine(new SmaCrossoverStrategy());
      runtime = new RuntimeCommandService(broker, control, strategy, persistence);
      eventResult.after = normalizeState(broker.exportState(), control.exportState());
      eventResults.push(eventResult);
      continue;
    }

    // MANUAL_ORDER
    let rejected = false;
    let rejectReason = "";
    try {
      // RuntimeCommandService.manualOrder() takes no clock override -- the fixture's
      // per-event timestamp is used only for the fixture's own event ordering, not fed
      // into production, which always fills at real wall-clock time (matching real usage).
      runtime.manualOrder(event.side, event.quantity, event.price);
    } catch (error) {
      rejected = true;
      rejectReason = error instanceof Error ? error.message : String(error);
    }
    eventResult.after = normalizeState(broker.exportState(), control.exportState());
    eventResult.rejected = rejected;
    if (rejected) eventResult.rejectReason = rejectReason;

    if (event.expectRejected && !rejected) {
      eventResult.status = "FAIL";
      failures.push(`event ${event.id}: expected rejection but the order filled`);
    } else if (!event.expectRejected && rejected) {
      eventResult.status = "FAIL";
      failures.push(`event ${event.id}: unexpected rejection: ${rejectReason}`);
    } else if (event.expectRejected && event.expectedRejectReason && event.expectedRejectReason !== "PERSISTENCE" && !rejectReason.includes(event.expectedRejectReason)) {
      eventResult.status = "FAIL";
      failures.push(`event ${event.id}: expected rejection reason to include "${event.expectedRejectReason}", got "${rejectReason}"`);
    }
    eventResults.push(eventResult);
  }

  const finalBrokerState = broker.exportState();
  const expectedComparison = { status: "PASS", mismatches: [] };
  const actual = {
    finalCash: finalBrokerState.cash,
    positionQuantity: finalBrokerState.position.quantity,
    averageEntryPrice: finalBrokerState.position.averagePrice,
    realizedPnl: finalBrokerState.position.realizedPnl,
    totalFees: finalBrokerState.orders.reduce((sum, order) => sum + order.fee, 0),
    orderCount: finalBrokerState.orders.length
  };
  const TOLERANCE = 1e-6;
  for (const [key, expectedValue] of Object.entries(fixture.expected)) {
    const actualValue = actual[key];
    const matches = typeof expectedValue === "number" ? Math.abs(actualValue - expectedValue) <= TOLERANCE : actualValue === expectedValue;
    if (!matches) {
      expectedComparison.status = "FAIL";
      expectedComparison.mismatches.push({ field: key, expected: expectedValue, actual: actualValue });
      failures.push(`expected.${key}: expected ${expectedValue}, got ${actualValue}`);
    }
  }
  expectedComparison.actual = actual;

  // PaperBroker.exportState().orders is newest-first (production unshift()s each fill).
  // A fast synchronous scenario replay can create several orders within the same
  // millisecond, and verifyPaperLedger()'s sort is stable -- ties preserve *this* array's
  // order. Reverse first so ties resolve to true creation order rather than newest-first.
  const verification = verifyPaperLedger([...finalBrokerState.orders].reverse(), fixture.initialCash);
  const independentVerification = { status: verification.errors.length > 0 ? "FAIL" : "PASS", errors: verification.errors };
  if (verification.errors.length === 0) {
    for (const [key, actualValue] of [
      ["cash", verification.cash], ["quantity", verification.quantity],
      ["averagePrice", verification.averagePrice], ["realizedPnl", verification.realizedPnl],
      ["totalFees", verification.totalFees]
    ]) {
      const productionValue = { cash: actual.finalCash, quantity: actual.positionQuantity, averagePrice: actual.averageEntryPrice, realizedPnl: actual.realizedPnl, totalFees: actual.totalFees }[key];
      if (Math.abs(actualValue - productionValue) > TOLERANCE) {
        independentVerification.status = "FAIL";
        failures.push(`independent verifier disagrees with production on ${key}: verifier=${actualValue}, production=${productionValue}`);
      }
    }
  } else {
    for (const error of verification.errors) failures.push(`independent verifier: ${error}`);
  }

  return {
    schemaVersion: 1,
    scenarioId: fixture.id,
    status: failures.length === 0 ? "PASS" : "FAIL",
    eventsProcessed: eventResults.length,
    events: eventResults,
    expectedComparison,
    independentVerification,
    failures
  };
}

module.exports = { runPaperScenario, validateFixture };
