const test = require("node:test");
const assert = require("node:assert/strict");
const { buildWorldModelSnapshot } = require("../dist/apps/cloud/src/worldModel.js");
const { combineWorldModels } = require("../dist/apps/cloud/src/multiAgentWorldModel.js");

const snapshot = (id, source, regime) => buildWorldModelSnapshot({ snapshotId: id, observedAt: 100, source, price: 100, volatility: regime === "VOLATILE" ? 0.8 : 0.2, liquidity: 0.8, trendStrength: regime === "TRENDING" ? 0.8 : 0.2, evidenceQuality: "VERIFIED" }, 200);

test("AMWM combines independent world models deterministically", () => {
  const result = combineWorldModels([snapshot("a", "agent-a", "TRENDING"), snapshot("b", "agent-b", "TRENDING"), snapshot("c", "agent-c", "RANGING")]);
  assert.equal(result.regime, "TRENDING");
  assert.equal(result.recommendationOnly, true);
  assert.deepEqual(result.conflictingSnapshotIds, ["c"]);
});

test("duplicate sources are rejected", () => {
  assert.throws(() => combineWorldModels([snapshot("a", "same", "TRENDING"), snapshot("b", "same", "TRENDING")]), /duplicate/);
});
