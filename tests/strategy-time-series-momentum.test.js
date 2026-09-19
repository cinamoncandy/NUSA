const test = require("node:test");
const assert = require("node:assert/strict");

const { TimeSeriesMomentumStrategy } = require("../dist/packages/core/src/strategyEngine.js");
const { evaluatePaperCandidateStrategy } = require("../dist/apps/cloud/src/paperCandidateStrategy.js");

const LOOKBACK = 4;
const THRESHOLD = 0.05;

function run(prices, lookback = LOOKBACK, threshold = THRESHOLD) {
  const strategy = new TimeSeriesMomentumStrategy(lookback, threshold);
  const signals = [];
  const seen = [];
  for (let index = 0; index < prices.length; index += 1) {
    signals.push(strategy.onTick({ price: prices[index], timestamp: index }, { prices: [...seen] }));
    seen.push(prices[index]);
  }
  return signals;
}

test("construction refuses parameters outside the family definition", () => {
  assert.throws(() => new TimeSeriesMomentumStrategy(1, 0.03), /lookback/);
  assert.throws(() => new TimeSeriesMomentumStrategy(2.5, 0.03), /lookback/);
  assert.throws(() => new TimeSeriesMomentumStrategy(20, -0.01), /threshold/);
  assert.throws(() => new TimeSeriesMomentumStrategy(20, 1), /threshold/);
  // Zero is a legitimate band: it is the no-dead-band edge of the precommitted grid's axis.
  assert.doesNotThrow(() => new TimeSeriesMomentumStrategy(20, 0));
});

test("it holds until a full lookback of closes exists, then establishes a baseline", () => {
  const signals = run([100, 101, 102, 103, 104, 105]);
  // Needs lookback + 1 closes before it can compute a trailing return at all.
  for (let index = 0; index < LOOKBACK; index += 1) {
    assert.equal(signals[index].type, "HOLD");
    assert.equal(signals[index].reason, "warming-up");
  }
  assert.equal(signals[LOOKBACK].reason, "baseline-established");
  assert.equal(signals[LOOKBACK].type, "HOLD");
});

test("a move inside the dead band produces no trade", () => {
  // +3% over the lookback, under the 5% band.
  const signals = run([100, 100, 100, 100, 100, 103, 103]);
  const traded = signals.filter((signal) => signal.type !== "HOLD");
  assert.deepEqual(traded, [], "a sub-threshold move must not flip the state");
  assert.equal(signals.at(-1).reason, "inside-momentum-band");
});

test("crossing above the band buys, and crossing below it sells", () => {
  const rising = run([100, 100, 100, 100, 100, 110]);
  assert.equal(rising.at(-1).type, "BUY");
  assert.equal(rising.at(-1).reason, "trailing-return-crossed-above-band");

  const falling = run([100, 100, 100, 100, 100, 90]);
  assert.equal(falling.at(-1).type, "SELL");
  assert.equal(falling.at(-1).reason, "trailing-return-crossed-below-band");
});

test("it does not re-enter while the state is unchanged", () => {
  // Rises past the band and keeps rising: one entry, then band-riding holds.
  const signals = run([100, 100, 100, 100, 100, 110, 120, 130]);
  const entries = signals.filter((signal) => signal.type === "BUY");
  assert.equal(entries.length, 1, "staying above the band must not pay the round trip again");
});

test("confidence scales with how far past the band the move already is", () => {
  const marginal = run([100, 100, 100, 100, 100, 105.5]).at(-1);
  const decisive = run([100, 100, 100, 100, 100, 130]).at(-1);
  assert.equal(marginal.type, "BUY");
  assert.equal(decisive.type, "BUY");
  assert.ok(decisive.confidence > marginal.confidence, "a decisive crossing must outrank a marginal one");
  assert.ok(marginal.confidence >= 0 && decisive.confidence <= 1);
});

test("no signal depends on a bar that had not happened yet", () => {
  // The family is a transition detector, so its output is legitimately path dependent on earlier
  // closes -- as Donchian and RSI are. The property that actually rules out lookahead is the
  // other direction: extending the series must never revise a signal already emitted.
  const prefix = [100, 100, 100, 100, 100, 110];
  const base = run(prefix);
  for (const future of [[90], [200], [110, 40, 300]]) {
    const extended = run([...prefix, ...future]);
    assert.deepEqual(
      extended.slice(0, prefix.length).map((signal) => ({ type: signal.type, reason: signal.reason })),
      base.map((signal) => ({ type: signal.type, reason: signal.reason })),
      `appending ${JSON.stringify(future)} must not revise an earlier signal`
    );
  }
});

test("reset clears the position so a rerun is deterministic", () => {
  const strategy = new TimeSeriesMomentumStrategy(LOOKBACK, THRESHOLD);
  const prices = [100, 100, 100, 100, 100, 110];
  const once = [];
  const seen = [];
  for (let index = 0; index < prices.length; index += 1) {
    once.push(strategy.onTick({ price: prices[index], timestamp: index }, { prices: [...seen] }));
    seen.push(prices[index]);
  }
  strategy.reset();
  const twice = [];
  const seenAgain = [];
  for (let index = 0; index < prices.length; index += 1) {
    twice.push(strategy.onTick({ price: prices[index], timestamp: index }, { prices: [...seenAgain] }));
    seenAgain.push(prices[index]);
  }
  assert.deepEqual(twice.map((s) => s.type), once.map((s) => s.type));
});

// The grid can only matter if a qualifying candidate can actually be bound and executed. Registering
// a family in the research runner alone would leave the execution boundary throwing
// "unsupported PAPER candidate strategy family" the first time one qualified.
function observations(prices) {
  return prices.map((price, index) => ({
    id: `obs-${index}`,
    source: "CHART",
    market: "KRW-BTC",
    price,
    observedAt: 1000 + index
  }));
}

const spec = (parameters) => ({ familyId: "time-series-momentum", parameters });

test("the PAPER execution boundary reaches the new family instead of refusing it", () => {
  const decision = evaluatePaperCandidateStrategy(
    spec({ lookbackPeriod: 4, entryThreshold: 0.05 }),
    observations([100, 100, 100, 100, 100, 110]),
    2000,
    "KRW-BTC"
  );
  assert.equal(decision.action, "BUY");
  assert.match(decision.reason, /^TIME_SERIES_MOMENTUM:4:0\.05:/);
});

test("the boundary agrees with the strategy on the dead band", () => {
  const decision = evaluatePaperCandidateStrategy(
    spec({ lookbackPeriod: 4, entryThreshold: 0.05 }),
    observations([100, 100, 100, 100, 100, 103]),
    2000,
    "KRW-BTC"
  );
  assert.equal(decision.action, "HOLD");
  assert.equal(decision.score, 0);
});

test("the boundary refuses parameters outside the family definition", () => {
  const cases = [
    { lookbackPeriod: 0, entryThreshold: 0.03 },
    { lookbackPeriod: 501, entryThreshold: 0.03 },
    { lookbackPeriod: 20, entryThreshold: 1 },
    { lookbackPeriod: 20, entryThreshold: -0.01 },
    { lookbackPeriod: 20 }
  ];
  for (const parameters of cases) {
    assert.throws(
      () => evaluatePaperCandidateStrategy(spec(parameters), observations([100, 100, 100, 100, 100, 110]), 2000, "KRW-BTC"),
      /time-series momentum candidate parameters are invalid/,
      `${JSON.stringify(parameters)} must be refused`
    );
  }
});

test("too few observations wait rather than guessing", () => {
  const decision = evaluatePaperCandidateStrategy(
    spec({ lookbackPeriod: 20, entryThreshold: 0.03 }),
    observations([100, 101, 102]),
    2000,
    "KRW-BTC"
  );
  assert.equal(decision.action, "WAIT");
  assert.match(decision.reason, /INSUFFICIENT_TSMOM_OBSERVATIONS:3\/21/);
});

// Registration in the research runner is what puts the family into the grid. Without it the
// family exists but is never evaluated, which is this repository's recurring failure shape.
const runner = require("../scripts/research-real-market-run.js");

test("the family is registered in the research runner's grid", () => {
  assert.equal(runner.researchStrategyFamily("time-series-momentum"), "time-series-momentum");
  const grid = runner.TSMOM_PARAMETER_NEIGHBORHOOD;
  assert.equal(grid.length, 12, "4 lookbacks x 3 thresholds");
  assert.ok(Object.isFrozen(grid) && grid.every(Object.isFrozen), "the neighbourhood is precommitted, so it must be frozen");
  assert.equal(new Set(grid.map((p) => `${p.lookbackPeriod}|${p.entryThreshold}`)).size, 12, "no duplicate cells");
  assert.deepEqual([...new Set(grid.map((p) => p.lookbackPeriod))], [10, 20, 40, 60]);
  assert.deepEqual([...new Set(grid.map((p) => p.entryThreshold))], [0.01, 0.03, 0.05]);
});

test("parameter stability is measured across both axes of the grid", () => {
  const candles = Array.from({ length: 50 }, (_, index) => ({ timestamp: 1000 + index, open: 100, high: 101, low: 99, close: 100 + index, volume: 1 }));
  const manifest = { market: "KRW-BTC", datasetId: "ds1", contentSha256: "a".repeat(64), marketSetVersion: "v1" };
  const request = runner.buildParameterRobustnessRequest({ candles, manifest, strategyFamily: "time-series-momentum" });
  const grid = request.candidateGrid;
  assert.equal(request.strategyFamily, "time-series-momentum");
  assert.equal(grid.length, 12);
  const keys = new Set(grid.map((entry) => entry.key));
  assert.ok(grid.every((entry) => entry.neighbors.every((key) => keys.has(key))), "every neighbour must be a real cell");
  const byKey = new Map(grid.map((entry) => [entry.key, entry.neighbors]));
  assert.ok(grid.every((entry) => entry.neighbors.every((key) => byKey.get(key).includes(entry.key))), "adjacency must be symmetric");
  // A 4x3 lattice: corners have 2 neighbours, edges 3, interior 4. A one-dimensional chain here
  // would silently measure stability along only one axis.
  assert.deepEqual([...grid.map((entry) => entry.neighbors.length)].sort(), [2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4]);
  assert.ok(request.referenceParameters.every((reference) => keys.has(reference.candidateKey)), "reference parameters must name real cells");
});
