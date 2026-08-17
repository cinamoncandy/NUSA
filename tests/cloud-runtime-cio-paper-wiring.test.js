const test = require("node:test");
const assert = require("node:assert/strict");
const { CloudRuntimeDashboardHydrator } = require("../dist/apps/cloud/src/cloudRuntimeDashboardHydrator.js");
const { InMemoryCloudDashboardStateProvider } = require("../dist/apps/cloud/src/cloudDashboardStateProvider.js");
const { buildMobileDashboardResponse } = require("../dist/apps/cloud/src/mobileDashboardApi.js");

const principal = Object.freeze({ userId: "operator", scopes: Object.freeze(["dashboard:read"]) });

function observation(market, sentiment) {
  return Object.freeze({
    id: `${market}:9000`,
    source: "CHART",
    market,
    sentiment,
    confidence: 1,
    observedAt: 9_000,
    expiresAt: 20_000,
    summary: `${market} fixture`
  });
}

test("market-scoped evidence produces executable PAPER CIO decisions with exact symbols", () => {
  const provider = new InMemoryCloudDashboardStateProvider();
  const hydrator = new CloudRuntimeDashboardHydrator({ now: () => 10_000, maxPaperAllocation: 0.1 });
  hydrator.hydrate(provider, [observation("KRW-BTC", 1), observation("KRW-ETH", -1)]);

  const state = provider.read(principal);
  assert.ok(state);
  const dashboard = buildMobileDashboardResponse(state);
  assert.equal(state.killSwitchActive, false);
  assert.equal(state.overallHealth, "HEALTHY");
  assert.equal(dashboard.tradingAllowed, true);
  assert.deepEqual(state.decisions.map((item) => [item.symbol, item.action]), [
    ["KRW-BTC", "BUY"],
    ["KRW-ETH", "WAIT"]
  ]);
  assert.equal(state.decisions[0].allocation, 0.1);
  assert.equal(state.decisions[0].leverage, 1);
});

test("missing market-scoped evidence remains fail-closed", () => {
  const provider = new InMemoryCloudDashboardStateProvider();
  const hydrator = new CloudRuntimeDashboardHydrator({ now: () => 10_000 });
  hydrator.hydrate(provider, []);

  const state = provider.read(principal);
  assert.ok(state);
  assert.equal(state.killSwitchActive, true);
  assert.equal(state.overallHealth, "DOWN");
  assert.equal(state.decisions.length, 1);
  assert.equal(state.decisions[0].action, "WAIT");
  assert.equal(buildMobileDashboardResponse(state).tradingAllowed, false);
});
