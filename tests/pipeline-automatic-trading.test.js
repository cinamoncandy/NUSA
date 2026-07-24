const test = require("node:test");
const assert = require("node:assert/strict");
const { ControlPlane } = require("../dist/apps/desktop/src/controlPlane.js");
const { PaperBroker } = require("../dist/apps/desktop/src/paperBroker.js");
const { SmaCrossoverStrategy, StrategyEngine } = require("../dist/apps/desktop/src/strategyEngine.js");
const { AutomaticTradingPipeline } = require("../dist/apps/server/src/pipeline/automaticTradingPipeline.js");
const { RiskEngine } = require("../dist/apps/server/src/pipeline/riskEngine.js");
const { FixedOrderPlanner } = require("../dist/apps/server/src/pipeline/orderPlanner.js");
const { PaperExecutor } = require("../dist/apps/server/src/pipeline/paperExecutor.js");
const { DefaultRiskEngine: ValueRiskEngine } = require("../dist/packages/core/src/risk/riskEngine.js");
const { DefaultOrderPlanner: ValueOrderPlanner } = require("../dist/packages/core/src/order/orderPlanner.js");
const { DefaultPortfolioLedger } = require("../dist/packages/core/src/portfolio/portfolio.js");
const { DefaultPnLCalculator } = require("../dist/packages/core/src/pnl/pnl.js");

const clone = (value) => JSON.parse(JSON.stringify(value));
const intent = (type, timestamp = 1) => ({ type, reason: "test", confidence: 1, timestamp });

function harness(options = {}) {
  const broker = new PaperBroker(10_000_000, "KRW-BTC", 0, options.riskPolicy ?? {});
  const control = new ControlPlane("web-runtime");
  const strategy = new StrategyEngine(new SmaCrossoverStrategy(2, 3));
  const durable = [];
  let fail = false;
  const persist = (paper, controlState) => {
    if (fail) throw new Error("injected persistence failure");
    durable.push({ paper: clone(paper), control: clone(controlState) });
  };
  let failureCalls = 0;
  const pipeline = new AutomaticTradingPipeline(
    broker,
    control,
    strategy,
    new RiskEngine(),
    options.orderPlanner ?? new FixedOrderPlanner("FIXED"),
    new PaperExecutor(broker),
    persist,
    () => { failureCalls += 1; },
    options.valueRiskEngine,
    options.policyFor,
    options.valueOrderPlanner,
    options.executionPolicy,
    options.referenceAccounting
  );
  return { broker, control, strategy, pipeline, durable, failNext: () => { fail = true; }, failureCalls: () => failureCalls };
}

test("HOLD intent is skipped and still persists (no state change)", () => {
  const { pipeline, durable } = harness();
  const result = pipeline.process(intent("HOLD"), "KRW-BTC", 100_000_000, 10_000_000);
  assert.equal(result.outcome, "SKIPPED");
  assert.equal(durable.length, 1);
});

test("BUY/SELL are rejected when auto-trade is not enabled", () => {
  const { control, pipeline } = harness();
  control.start(); // status RUNNING but autoTradeEnabled still false
  const result = pipeline.process(intent("BUY"), "KRW-BTC", 100_000_000, 10_000_000);
  assert.equal(result.outcome, "REJECTED");
  assert.match(result.reason, /not enabled/);
});

test("duplicate signal key is claimed only once", () => {
  const { control, pipeline } = harness();
  control.start();
  control.setAutoTrade(true);
  const first = pipeline.process(intent("BUY", 5), "KRW-BTC", 100_000_000, 10_000_000);
  assert.equal(first.outcome, "FILLED");
  const second = pipeline.process(intent("BUY", 5), "KRW-BTC", 100_000_000, 10_000_000);
  assert.equal(second.outcome, "DUPLICATE");
});

test("SELL with no open position is rejected by RiskEngine before OrderPlanner runs", () => {
  const { control, pipeline } = harness();
  control.start();
  control.setAutoTrade(true);
  const result = pipeline.process(intent("SELL", 5), "KRW-BTC", 100_000_000, 10_000_000);
  assert.equal(result.outcome, "REJECTED");
  assert.match(result.reason, /insufficient/);
});

test("a successful BUY fills through PaperExecutor and updates Position/Portfolio", () => {
  const { control, pipeline, broker, durable } = harness();
  control.start();
  control.setAutoTrade(true);
  const result = pipeline.process(intent("BUY", 5), "KRW-BTC", 100_000_000, 10_000_000);
  assert.equal(result.outcome, "FILLED");
  assert.ok(result.order);
  assert.equal(result.order.side, "BUY");
  const snapshot = broker.snapshot(100_000_000);
  assert.ok(snapshot.position.quantity > 0);
  assert.equal(durable.length, 1);
  assert.ok(durable[0].paper.position.quantity > 0);
});

test("OrderPlanner returning null (sizing decided against trading) skips without executing", () => {
  const noPlanPlanner = { plan: () => null };
  const { control, pipeline, broker } = harness({ orderPlanner: noPlanPlanner });
  control.start();
  control.setAutoTrade(true);
  const before = broker.snapshot(100_000_000);
  const result = pipeline.process(intent("BUY", 5), "KRW-BTC", 100_000_000, 10_000_000);
  assert.equal(result.outcome, "SKIPPED");
  assert.deepEqual(broker.snapshot(100_000_000).position, before.position);
});

test("FIXED_FRACTIONAL sizing below the broker's dust threshold is rejected by PaperExecutor, not silently skipped", () => {
  const tinyPlanner = new FixedOrderPlanner("FIXED_FRACTIONAL", 0.000000001);
  const { control, pipeline, broker } = harness({ orderPlanner: tinyPlanner });
  control.start();
  control.setAutoTrade(true);
  const before = broker.snapshot(100_000_000);
  const result = pipeline.process(intent("BUY", 5), "KRW-BTC", 100_000_000, 10_000_000);
  assert.equal(result.outcome, "REJECTED");
  assert.match(result.reason, /dust threshold|market step/);
  assert.deepEqual(broker.snapshot(100_000_000).position, before.position);
});

test("a broker-rejected order (risk policy violation) is REJECTED with the broker's message, no partial mutation", () => {
  const { control, pipeline, broker } = harness({ riskPolicy: { maxOrderNotional: 1 } });
  control.start();
  control.setAutoTrade(true);
  const before = broker.snapshot(100_000_000);
  const result = pipeline.process(intent("BUY", 5), "KRW-BTC", 100_000_000, 10_000_000);
  assert.equal(result.outcome, "REJECTED");
  assert.match(result.reason, /max order notional/);
  assert.deepEqual(broker.snapshot(100_000_000).position, before.position);
});

test("a persistence failure rolls back broker/control state and reports via the failure callback", () => {
  const { control, pipeline, broker, failNext, failureCalls } = harness();
  control.start();
  control.setAutoTrade(true);
  const before = { paper: clone(broker.exportState()), control: clone(control.exportState()) };
  failNext();
  const result = pipeline.process(intent("BUY", 5), "KRW-BTC", 100_000_000, 10_000_000);
  assert.equal(result.outcome, "REJECTED");
  assert.equal(result.reason, "persistence failure");
  assert.deepEqual(clone(broker.exportState()), before.paper, "broker state must roll back to the pre-attempt snapshot");
  assert.deepEqual(clone(control.exportState()), before.control, "control state must roll back to the pre-attempt snapshot");
  assert.equal(failureCalls(), 1);
});

test("when wired (E02-T002), the value-based RiskEngine blocks a plan exceeding maximumPositionValue before PaperExecutor runs", () => {
  const { control, pipeline, broker } = harness({
    valueRiskEngine: new ValueRiskEngine(),
    policyFor: (price) => ({ minimumOrderValue: 0, maximumPositionValue: 100 }) // deliberately tiny cap
  });
  control.start();
  control.setAutoTrade(true);
  const before = broker.snapshot(100_000_000);
  const result = pipeline.process(intent("BUY", 5), "KRW-BTC", 100_000_000, 10_000_000);
  assert.equal(result.outcome, "REJECTED");
  assert.match(result.reason, /maximumPositionValue/);
  assert.deepEqual(broker.snapshot(100_000_000).position, before.position, "no partial mutation from the blocked plan");
});

test("when wired, a plan within the value-based policy still fills normally", () => {
  const { control, pipeline, broker } = harness({
    valueRiskEngine: new ValueRiskEngine(),
    policyFor: (price) => ({ minimumOrderValue: 0, maximumPositionValue: 100_000_000 })
  });
  control.start();
  control.setAutoTrade(true);
  const result = pipeline.process(intent("BUY", 5), "KRW-BTC", 100_000_000, 10_000_000);
  assert.equal(result.outcome, "FILLED");
  assert.ok(broker.snapshot(100_000_000).position.quantity > 0);
});

test("without valueRiskEngine/policyFor wired, behavior is unchanged from before E02-T002 (opt-in, not a default block)", () => {
  const { control, pipeline, broker } = harness(); // no valueRiskEngine/policyFor
  control.start();
  control.setAutoTrade(true);
  const result = pipeline.process(intent("BUY", 5), "KRW-BTC", 100_000_000, 10_000_000);
  assert.equal(result.outcome, "FILLED");
  assert.ok(broker.snapshot(100_000_000).position.quantity > 0);
});

test("when wired (E02-T003), a successful plan is recorded as a SYSTEM event and the trade still fills through PaperExecutor's own fill model", () => {
  const { control, pipeline, broker } = harness({
    valueRiskEngine: new ValueRiskEngine(),
    policyFor: () => ({ minimumOrderValue: 0, maximumPositionValue: 100_000_000 }),
    valueOrderPlanner: new ValueOrderPlanner(),
    executionPolicy: { feeRate: 0.001, slippageRate: 0.01 }
  });
  control.start();
  control.setAutoTrade(true);
  const result = pipeline.process(intent("BUY", 5), "KRW-BTC", 100_000_000, 10_000_000);
  assert.equal(result.outcome, "FILLED");
  assert.ok(broker.snapshot(100_000_000).position.quantity > 0);
  const plannedEvent = control.snapshot().events.find((event) => event.type === "SYSTEM" && event.message === "planned order computed");
  assert.ok(plannedEvent, "expected a planned-order audit event");
  assert.equal(plannedEvent.data.side, "BUY");
  assert.ok(plannedEvent.data.executionPrice > 100_000_000, "BUY executionPrice should be above marketPrice with positive slippageRate");
});

test("when wired, a FAILED PlannerResult (e.g. slippageRate driving SELL executionPrice to 0) rejects the trade without executing", () => {
  const { control, pipeline, broker } = harness({
    valueRiskEngine: new ValueRiskEngine(),
    policyFor: () => ({ minimumOrderValue: 0, maximumPositionValue: 100_000_000 }),
    valueOrderPlanner: new ValueOrderPlanner(),
    executionPolicy: { feeRate: 0.001, slippageRate: 1 }
  });
  control.start();
  control.setAutoTrade(true);
  // Give the account an open position first (bypassing the pipeline) so a SELL intent is risk-approved.
  broker.execute("BUY", 0.001, 100_000_000);
  const before = broker.snapshot(100_000_000);
  const result = pipeline.process(intent("SELL", 5), "KRW-BTC", 100_000_000, 10_000_000);
  assert.equal(result.outcome, "REJECTED");
  assert.match(result.reason, /executionPrice/);
  assert.deepEqual(broker.snapshot(100_000_000).position, before.position, "no execution should occur after a FAILED plan");
});

test("without valueOrderPlanner/executionPolicy wired, behavior is unchanged (opt-in, not a default block)", () => {
  const { control, pipeline, broker } = harness({
    valueRiskEngine: new ValueRiskEngine(),
    policyFor: () => ({ minimumOrderValue: 0, maximumPositionValue: 100_000_000 })
    // valueOrderPlanner/executionPolicy intentionally omitted
  });
  control.start();
  control.setAutoTrade(true);
  const result = pipeline.process(intent("BUY", 5), "KRW-BTC", 100_000_000, 10_000_000);
  assert.equal(result.outcome, "FILLED");
  assert.ok(broker.snapshot(100_000_000).position.quantity > 0);
});

test("a FILLED trade always records a formal ExecutionReport (E02-T005) as a SYSTEM audit event", () => {
  const { control, pipeline } = harness();
  control.start();
  control.setAutoTrade(true);
  const result = pipeline.process(intent("BUY", 5), "KRW-BTC", 100_000_000, 10_000_000);
  assert.equal(result.outcome, "FILLED");
  const reportEvent = control.snapshot().events.find((event) => event.type === "SYSTEM" && event.message === "execution report");
  assert.ok(reportEvent, "expected an execution-report audit event");
  assert.equal(reportEvent.data.status, "FILLED");
  assert.equal(reportEvent.data.side, "BUY");
  assert.equal(reportEvent.data.symbol, "KRW-BTC");
  assert.ok(reportEvent.data.orderValue > 0);
});

test("a REJECTED trade (broker risk-policy violation) also records a REJECTED ExecutionReport", () => {
  const { control, pipeline } = harness({ riskPolicy: { maxOrderNotional: 1 } });
  control.start();
  control.setAutoTrade(true);
  const result = pipeline.process(intent("BUY", 5), "KRW-BTC", 100_000_000, 10_000_000);
  assert.equal(result.outcome, "REJECTED");
  const reportEvent = control.snapshot().events.find((event) => event.type === "SYSTEM" && event.message === "execution report");
  assert.ok(reportEvent, "expected an execution-report audit event even on rejection");
  assert.equal(reportEvent.data.status, "REJECTED");
  assert.match(reportEvent.data.reason, /max order notional/);
});

test("when wired (E02-T006/T007), a FILLED trade updates the reference Portfolio and records its PnL", () => {
  let referencePortfolio = { cash: 10_000_000, quantity: 0, averagePrice: 0, realizedPnl: 0 };
  const { control, pipeline } = harness({
    referenceAccounting: {
      ledger: new DefaultPortfolioLedger(),
      pnlCalculator: new DefaultPnLCalculator(),
      getPortfolio: () => referencePortfolio,
      setPortfolio: (next) => { referencePortfolio = next; }
    }
  });
  control.start();
  control.setAutoTrade(true);
  const result = pipeline.process(intent("BUY", 5), "KRW-BTC", 100_000_000, 10_000_000);
  assert.equal(result.outcome, "FILLED");

  assert.ok(referencePortfolio.quantity > 0, "the reference portfolio held outside the pipeline must have been updated");
  assert.ok(referencePortfolio.cash < 10_000_000);

  const portfolioEvent = control.snapshot().events.find((event) => event.type === "SYSTEM" && event.message === "reference portfolio");
  assert.ok(portfolioEvent, "expected a reference-portfolio audit event");
  assert.deepEqual(portfolioEvent.data.portfolio, referencePortfolio);
  assert.equal(typeof portfolioEvent.data.pnl.totalPnl, "number");
});

test("without referenceAccounting wired, no reference-portfolio event is recorded and behavior is unchanged", () => {
  const { control, pipeline } = harness(); // referenceAccounting intentionally omitted
  control.start();
  control.setAutoTrade(true);
  const result = pipeline.process(intent("BUY", 5), "KRW-BTC", 100_000_000, 10_000_000);
  assert.equal(result.outcome, "FILLED");
  const portfolioEvent = control.snapshot().events.find((event) => event.type === "SYSTEM" && event.message === "reference portfolio");
  assert.equal(portfolioEvent, undefined);
});
