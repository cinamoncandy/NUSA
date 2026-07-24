const test = require("node:test");
const assert = require("node:assert/strict");
const { runOrderbookImbalanceWalkForward } = require("../dist/apps/cloud/src/alpha/orderbook/OrderbookImbalanceWalkForward.js");

const hash = (char) => char.repeat(64);
const candidate = (candidateId, parameterHash, overrides = {}) => ({
  candidateId,
  parameterHash,
  trainReturn: 0.1,
  trainSharpe: 1.5,
  trainMaxDrawdown: 0.1,
  oosReturn: 0.04,
  oosSharpe: 0.8,
  oosMaxDrawdown: 0.12,
  oosTradeCount: 5,
  ...overrides
});
const window = (windowId, trainStart, trainEnd, testStart, testEnd, candidates) => ({ windowId, trainStart, trainEnd, testStart, testEnd, candidates });
const policy = {
  engineVersion: 1,
  mode: "ROLLING",
  minimumTrainSharpe: 0,
  maximumTrainDrawdown: 0.5,
  minimumOosTradeCount: 1,
  minimumPositiveWindowRatio: 0.5,
  minimumMeanOosSharpe: 0,
  maximumWorstOosDrawdown: 0.5,
  trainSharpeWeight: 1,
  trainReturnWeight: 1,
  trainDrawdownPenaltyWeight: 1
};

const rollingWindows = () => [
  window("W1", "2026-01-01T00:00:00.000Z", "2026-01-10T00:00:00.000Z", "2026-01-11T00:00:00.000Z", "2026-01-15T00:00:00.000Z", [
    candidate("A", hash("a"), { trainSharpe: 2, oosReturn: 0.03 }),
    candidate("B", hash("b"), { trainSharpe: 1, oosReturn: 0.9 })
  ]),
  window("W2", "2026-01-05T00:00:00.000Z", "2026-01-15T00:00:00.000Z", "2026-01-16T00:00:00.000Z", "2026-01-20T00:00:00.000Z", [
    candidate("A", hash("a"), { trainSharpe: 2.1, oosReturn: 0.02 }),
    candidate("B", hash("b"), { trainSharpe: 1.1, oosReturn: -0.8 })
  ])
];

test("selects candidates using train metrics only and aggregates OOS", () => {
  const result = runOrderbookImbalanceWalkForward(rollingWindows(), "2026-01-21T00:00:00.000Z", policy);
  assert.deepEqual(result.windows.map((item) => item.selectedCandidateId), ["A", "A"]);
  assert.equal(result.aggregate.positiveWindowRatio, 1);
  assert.equal(result.aggregate.candidateSwitchRatio, 0);
  assert.equal(result.aggregate.parameterDriftRatio, 0);
  assert.equal(result.aggregate.passed, true);
  assert.match(result.resultHash, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.windows));
});

test("is deterministic", () => {
  const first = runOrderbookImbalanceWalkForward(rollingWindows(), "2026-01-21T00:00:00.000Z", policy);
  const second = runOrderbookImbalanceWalkForward(rollingWindows(), "2026-01-21T00:00:00.000Z", policy);
  assert.deepEqual(first, second);
});

test("supports anchored windows", () => {
  const windows = [
    window("A1", "2026-01-01T00:00:00.000Z", "2026-01-10T00:00:00.000Z", "2026-01-11T00:00:00.000Z", "2026-01-15T00:00:00.000Z", [candidate("A", hash("a"))]),
    window("A2", "2026-01-01T00:00:00.000Z", "2026-01-15T00:00:00.000Z", "2026-01-16T00:00:00.000Z", "2026-01-20T00:00:00.000Z", [candidate("A", hash("a"))])
  ];
  const result = runOrderbookImbalanceWalkForward(windows, "2026-01-21T00:00:00.000Z", { ...policy, mode: "ANCHORED" });
  assert.equal(result.mode, "ANCHORED");
});

test("rejects overlapping OOS, duplicate candidates, bad hashes, and missing train eligibility", () => {
  const overlap = rollingWindows();
  overlap[1] = { ...overlap[1], testStart: "2026-01-14T00:00:00.000Z" };
  assert.throws(() => runOrderbookImbalanceWalkForward(overlap, "2026-01-21T00:00:00.000Z", policy), /non-overlapping|ordered/);

  const duplicate = rollingWindows();
  duplicate[0] = { ...duplicate[0], candidates: [candidate("A", hash("a")), candidate("A", hash("b"))] };
  assert.throws(() => runOrderbookImbalanceWalkForward(duplicate, "2026-01-21T00:00:00.000Z", policy), /duplicate candidate/);

  const invalidHash = rollingWindows();
  invalidHash[0] = { ...invalidHash[0], candidates: [candidate("A", "bad")] };
  assert.throws(() => runOrderbookImbalanceWalkForward(invalidHash, "2026-01-21T00:00:00.000Z", policy), /parameterHash/);

  assert.throws(() => runOrderbookImbalanceWalkForward(rollingWindows(), "2026-01-21T00:00:00.000Z", { ...policy, minimumTrainSharpe: 99 }), /no train-eligible candidate/);
});
