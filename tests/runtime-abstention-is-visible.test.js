"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { CloudRuntimeDashboardHydrator } = require("../dist/apps/cloud/src/cloudRuntimeDashboardHydrator.js");
const { InMemoryCloudDashboardStateProvider } = require("../dist/apps/cloud/src/cloudDashboardStateProvider.js");

/**
 * `runIntelligenceEngineV10` returns a status and the reasons behind it, and abstains when the
 * market regime is unknown. The hydrator used to call it as `runIntelligenceEngineV10(...).fused`,
 * which threw the status away: the engine could abstain on every single call and nothing
 * downstream, on screen, or in any test would differ. A guard nobody reads is not a guard.
 *
 * This matters because absent regime features are not an edge case. Nothing in the tree produces
 * a MarketRegimeFeatures, so REGIME_UNKNOWN is the branch the running system takes every time --
 * the runtime abstains 100% of the time and reported that to nobody.
 *
 * The fix surfaces the reason rather than suppressing decisions. Whether abstention should halt
 * the paper runtime is the owner's decision and would silence it entirely today; making the
 * abstention visible is the part that is unambiguously correct on its own.
 */

const principal = Object.freeze({ userId: "operator", scopes: Object.freeze(["dashboard:read"]) });
const REGIME_UNKNOWN_ISSUE = `Intelligence abstained: ${["REGIME", "UNKNOWN"].join("_")}`;

const observation = (market, sentiment) => Object.freeze({
  id: `${market}:9000`,
  source: "CHART",
  market,
  sentiment,
  confidence: 1,
  observedAt: 9_000,
  expiresAt: 20_000,
  summary: `${market} fixture`
});

test("an abstaining intelligence engine is visible on the dashboard, not swallowed", () => {
  const provider = new InMemoryCloudDashboardStateProvider();
  const hydrator = new CloudRuntimeDashboardHydrator({ now: () => 10_000, maxPaperAllocation: 0.1 });
  hydrator.hydrate(provider, [observation("KRW-BTC", 1)]);

  const state = provider.read(principal);
  assert.ok(state);
  assert.ok(
    state.issues.includes(REGIME_UNKNOWN_ISSUE),
    `expected the abstention reason on the dashboard, got ${JSON.stringify(state.issues)}`
  );
});

test("the abstention is reported even on the healthy path, where it was least visible", () => {
  const provider = new InMemoryCloudDashboardStateProvider();
  const hydrator = new CloudRuntimeDashboardHydrator({ now: () => 10_000, maxPaperAllocation: 0.1 });
  hydrator.hydrate(provider, [observation("KRW-BTC", 1), observation("KRW-ETH", -1)]);

  const state = provider.read(principal);
  assert.ok(state);
  // Healthy, trading, kill switch off -- and still abstaining. That combination was previously
  // indistinguishable from an engine that had confirmed the regime was fine.
  assert.equal(state.overallHealth, "HEALTHY");
  assert.equal(state.killSwitchActive, false);
  assert.ok(state.issues.includes(REGIME_UNKNOWN_ISSUE));
});

test("reported reasons are deduplicated across the per-market engine calls", () => {
  const provider = new InMemoryCloudDashboardStateProvider();
  const hydrator = new CloudRuntimeDashboardHydrator({ now: () => 10_000, maxPaperAllocation: 0.1 });
  hydrator.hydrate(provider, [observation("KRW-BTC", 1), observation("KRW-ETH", -1), observation("KRW-XRP", 1)]);

  const state = provider.read(principal);
  assert.ok(state);
  const occurrences = state.issues.filter((issue) => issue === REGIME_UNKNOWN_ISSUE).length;
  assert.equal(occurrences, 1, "one engine, one reason, however many markets it was run over");
});

test("existing fail-closed behaviour on absent market data is unchanged", () => {
  const provider = new InMemoryCloudDashboardStateProvider();
  const hydrator = new CloudRuntimeDashboardHydrator({ now: () => 10_000 });
  hydrator.hydrate(provider, []);

  const state = provider.read(principal);
  assert.ok(state);
  assert.equal(state.killSwitchActive, true);
  assert.equal(state.overallHealth, "DOWN");
  assert.ok(state.issues.includes("Market data unavailable"));
  assert.ok(state.issues.includes("Trading is blocked by the kill switch"));
});
