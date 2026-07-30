const test = require("node:test");
const assert = require("node:assert/strict");
const { simulatePortfolio } = require("../dist/apps/cloud/src/simulationEngine.js");

test("simulation is deterministic and side-effect free", () => {
  const report = simulatePortfolio({ startingCapital: 1000, portfolioWeight: 0.5, scenarios: [{ scenarioId: "base", returnShock: 0, liquidityMultiplier: 1 }, { scenarioId: "stress", returnShock: -0.4, liquidityMultiplier: 0.5 }] });
  assert.equal(report.worstCaseScenarioId, "stress");
  assert.equal(report.results[0].endingCapital, 800);
  assert.equal(report.productionMutationAllowed, false);
  assert.equal(report.sideEffectFree, true);
});

test("invalid scenarios fail closed", () => {
  assert.throws(() => simulatePortfolio({ startingCapital: 1000, portfolioWeight: 0.5, scenarios: [] }), /requires scenarios/);
});
