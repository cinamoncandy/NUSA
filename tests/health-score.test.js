const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateHealthScore } = require("../dist/apps/execution/src/health-score.js");

const healthy = (name, weight = 1) => ({ name, weight, status: "HEALTHY" });

test("calculates a deterministic overall score across critical runtime dimensions", () => {
  const result = calculateHealthScore({ dimensions: [
    healthy("Runtime"), healthy("Trading"), healthy("Risk"), healthy("Recovery"), healthy("Ledger"), healthy("Database"), healthy("Network"), healthy("WebSocket"), healthy("Memory"), healthy("CPU")
  ] });
  assert.equal(result.score, 100);
  assert.equal(result.status, "HEALTHY");
  assert.deepEqual(result.dimensions.map((item) => item.name), ["CPU", "Database", "Ledger", "Memory", "Network", "Recovery", "Risk", "Runtime", "Trading", "WebSocket"]);
});

test("unknown evidence is fail closed and failed dimensions block health", () => {
  const unknown = calculateHealthScore({ dimensions: [healthy("Runtime"), { name: "Ledger", status: "UNKNOWN", weight: 2 }] });
  assert.equal(unknown.score, null);
  assert.equal(unknown.status, "UNKNOWN");
  const failed = calculateHealthScore({ dimensions: [healthy("Runtime"), { name: "Recovery", status: "FAILED", weight: 2, reason: "reconciliation mismatch" }] });
  assert.equal(failed.status, "BLOCKED");
  assert.equal(failed.score, 33.33);
  assert.deepEqual(failed.blockingReasons, ["reconciliation mismatch"]);
});

test("rejects duplicate dimensions and invalid weights", () => {
  assert.throws(() => calculateHealthScore({ dimensions: [healthy("Runtime"), healthy("Runtime")] }), /duplicate health dimension/);
  assert.throws(() => calculateHealthScore({ dimensions: [{ name: "Runtime", status: "HEALTHY", weight: 0 }] }), /weight must be positive/);
});
