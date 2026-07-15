const test = require("node:test");
const assert = require("node:assert/strict");
const { runDeterministicMonteCarlo } = require("../dist/apps/cloud/src/monteCarloResearch.js");

const input = { returns: [-0.02, -0.01, 0.01, 0.03], pathCount: 1_000, horizon: 30, ruinThreshold: 0.5, seed: "dataset-sha|strategy-v1" };

test("Monte Carlo replay is deterministic and immutable", () => {
  const first = runDeterministicMonteCarlo(input);
  const second = runDeterministicMonteCarlo({ ...input });
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.match(first.seedHash, /^[a-f0-9]{64}$/);
});

test("Monte Carlo rejects invalid samples and unsafe configuration", () => {
  assert.throws(() => runDeterministicMonteCarlo({ ...input, returns: [0.01] }), /at least two/);
  assert.throws(() => runDeterministicMonteCarlo({ ...input, returns: [-1, 0.01] }), /above -1/);
  assert.throws(() => runDeterministicMonteCarlo({ ...input, pathCount: 99 }), /pathCount/);
  assert.throws(() => runDeterministicMonteCarlo({ ...input, seed: "" }), /seed/);
});
