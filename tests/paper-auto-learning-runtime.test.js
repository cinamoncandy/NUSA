const test = require("node:test");
const assert = require("node:assert/strict");
const { PaperTradingExecutionLoop } = require("../dist/apps/cloud/src/paperTradingExecutionLoop.js");
const { PaperAutoLearningRuntime } = require("../dist/apps/cloud/src/paperAutoLearningRuntime.js");

const healthy = () => ({ killSwitchActive: false, tradingAllowed: true, overallHealth: "HEALTHY" });
const decision = (action, decidedAt, allocation = action === "BUY" ? 0.5 : 0) => Object.freeze({
  symbol: "KRW-BTC",
  action,
  confidence: 0.8,
  risk: "LOW",
  allocation,
  leverage: 1,
  score: action === "BUY" ? 0.8 : -0.8,
  reasons: Object.freeze(["deterministic test decision"]),
  decidedAt
});
const observation = (now, price = 100, observedAt = now) => Object.freeze({ market: "KRW-BTC", price, observedAt, now, trusted: true });

function runtime(options = {}) {
  const execution = options.execution ?? new PaperTradingExecutionLoop({ initialCapital: 1_000, feeRate: 0 });
  let nextDecision = decision("BUY", 1_000);
  const evidence = { observed: 0, completed: 0, duplicates: 0,
    sessionObserved() { this.observed += 1; },
    orderCompleted() { this.completed += 1; },
    duplicateOrderChecked() { this.duplicates += 1; }
  };
  const research = { calls: 0, onMarketData() { this.calls += 1; } };
  const control = options.control ?? healthy;
  const instance = new PaperAutoLearningRuntime({
    execution,
    decisions: () => [nextDecision],
    control,
    evidence,
    research,
    maxObservationAgeMs: 30_000
  });
  return { instance, execution, evidence, research, setDecision(value) { nextDecision = value; } };
}

test("PAPER auto-learning executes deterministic BUY then SELL without manual confirmation", () => {
  const subject = runtime();
  const buy = subject.instance.onMarketObservation(observation(1_000));
  assert.equal(buy.status, "RUNNING");
  assert.equal(buy.lastExecutionStatus, "FILLED");
  assert.equal(buy.lastFill.side, "BUY");
  assert.equal(buy.account.fills.length, 1);
  assert.ok(buy.account.positions[0].quantity > 0);

  subject.setDecision(decision("SELL", 2_000, 0));
  const sell = subject.instance.onMarketObservation(observation(2_000, 110));
  assert.equal(sell.status, "RUNNING");
  assert.equal(sell.lastExecutionStatus, "FILLED");
  assert.equal(sell.lastFill.side, "SELL");
  assert.equal(sell.account.fills.length, 2);
  assert.equal(sell.account.positions[0].quantity, 0);
  assert.equal(subject.evidence.completed, 2);
  assert.equal(subject.research.calls, 2);
});

test("same governed decision retry is idempotent and never double-fills", () => {
  const subject = runtime();
  subject.instance.onMarketObservation(observation(1_000));
  const retry = subject.instance.onMarketObservation(observation(1_000));
  assert.equal(retry.lastExecutionStatus, "DUPLICATE");
  assert.equal(retry.account.fills.length, 1);
  assert.equal(subject.evidence.duplicates, 1);
});

test("restart from persisted PAPER state preserves idempotency tombstones", () => {
  let persisted;
  const repository = {
    save(state) { persisted = state; },
    loadLatest() { return persisted; },
    clear() { persisted = undefined; }
  };
  const firstLoop = new PaperTradingExecutionLoop({ initialCapital: 1_000, feeRate: 0, repository });
  const first = runtime({ execution: firstLoop });
  first.instance.onMarketObservation(observation(1_000));
  assert.equal(persisted.fills.length, 1);

  const restartedLoop = new PaperTradingExecutionLoop({ initialCapital: 1_000, feeRate: 0, repository });
  const restarted = runtime({ execution: restartedLoop });
  const retry = restarted.instance.onMarketObservation(observation(1_000));
  assert.equal(retry.lastExecutionStatus, "DUPLICATE");
  assert.equal(retry.account.fills.length, 1);
});

test("pause and risk HALT prevent autonomous simulated orders", () => {
  const paused = runtime();
  paused.instance.pause();
  const pausedState = paused.instance.onMarketObservation(observation(1_000));
  assert.equal(pausedState.status, "PAUSED");
  assert.equal(pausedState.account.fills.length, 0);

  const halted = runtime({ control: () => ({ killSwitchActive: true, tradingAllowed: false, overallHealth: "HALTED" }) });
  const haltedState = halted.instance.onMarketObservation(observation(1_000));
  assert.equal(haltedState.status, "HALTED");
  assert.equal(haltedState.lastReason, "PAPER_RISK_HALT");
  assert.equal(haltedState.account.fills.length, 0);
});

test("untrusted and stale market inputs fail closed", () => {
  const untrusted = runtime();
  const untrustedState = untrusted.instance.onMarketObservation({ ...observation(1_000), trusted: false });
  assert.equal(untrustedState.status, "ERROR");
  assert.equal(untrustedState.lastError, "PAPER_MARKET_INPUT_UNTRUSTED");
  assert.equal(untrustedState.account.fills.length, 0);

  const stale = runtime();
  const staleState = stale.instance.onMarketObservation({ market: "KRW-BTC", price: 100, observedAt: 1_000, now: 31_000, trusted: true });
  assert.equal(staleState.status, "ERROR");
  assert.equal(staleState.lastError, "PAPER_MARKET_INPUT_STALE");
  assert.equal(staleState.account.fills.length, 0);
});

test("non-monotonic PAPER observations fail closed before a second simulated fill", () => {
  const subject = runtime();
  subject.instance.onMarketObservation(observation(2_000));
  const regressed = subject.instance.onMarketObservation(observation(1_000, 110));
  assert.equal(regressed.status, "ERROR");
  assert.equal(regressed.lastError, "PAPER_MARKET_CHRONOLOGY_REGRESSION");
  assert.equal(regressed.account.fills.length, 1);
});

test("PAPER runtime clock regression fails closed even when market observation order is monotonic", () => {
  const subject = runtime();
  subject.instance.onMarketObservation(observation(3_000, 100, 1_000));
  const regressed = subject.instance.onMarketObservation(observation(2_000, 110, 1_500));
  assert.equal(regressed.status, "ERROR");
  assert.equal(regressed.lastError, "PAPER_RUNTIME_CLOCK_REGRESSION");
  assert.equal(regressed.account.fills.length, 1);
});

test("persistence or research failure transitions auto-learning to ERROR and stops future orders", () => {
  const badRepository = { save() { throw new Error("disk failure"); }, loadLatest() { return undefined; }, clear() {} };
  const execution = new PaperTradingExecutionLoop({ initialCapital: 1_000, feeRate: 0, repository: badRepository });
  const persistence = runtime({ execution });
  const failed = persistence.instance.onMarketObservation(observation(1_000));
  assert.equal(failed.status, "ERROR");
  assert.equal(failed.lastExecutionStatus, "FAILED");
  assert.equal(failed.account.fills.length, 0);
  const stopped = persistence.instance.onMarketObservation(observation(2_000));
  assert.equal(stopped.account.fills.length, 0);

  const researchLoop = new PaperTradingExecutionLoop({ initialCapital: 1_000, feeRate: 0 });
  const researchRuntime = new PaperAutoLearningRuntime({
    execution: researchLoop,
    decisions: () => [decision("BUY", 1_000)],
    control: healthy,
    research: { onMarketData() { throw new Error("research ledger unavailable"); } }
  });
  const researchFailed = researchRuntime.onMarketObservation(observation(1_000));
  assert.equal(researchFailed.status, "ERROR");
  assert.equal(researchFailed.lastError, "research ledger unavailable");
  assert.equal(researchFailed.account.fills.length, 1);
  const noSecondOrder = researchRuntime.onMarketObservation(observation(2_000));
  assert.equal(noSecondOrder.account.fills.length, 1);
});
