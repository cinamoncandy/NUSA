"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const { runIntelligenceEngineV10 } = require("../dist/apps/cloud/src/intelligenceEngineV10.js");

const ROOT = join(__dirname, "..");

/**
 * The Intelligence stage abstains on three regime conditions, the load-bearing one being
 * `allowNewExposure` -- it is the regime that grants exposure. When `regimeFeatures` became
 * optional so the stage could be wired without a producer, absence took the early return and
 * reported READY, which made "no regime data" indistinguishable from "the regime is fine". Both
 * README.md and docs/PIPELINE_TO_CODE.md state the rule this broke: fail closed on uncertainty.
 *
 * This is not an edge case. Nothing in the tree produces a MarketRegimeFeatures, so the absent
 * branch is the only branch the running system takes.
 */

const observation = (now) => Object.freeze({
  id: "fixture-observation",
  source: "RISK",
  sentiment: 0.5,
  confidence: 0.9,
  observedAt: now,
  expiresAt: now + 60_000,
  summary: "fixture"
});

const NOW = 1_700_000_000_000;

test("an unknown regime abstains and names why", () => {
  const result = runIntelligenceEngineV10({ now: NOW, observations: [observation(NOW)] });
  assert.equal(result.status, "ABSTAIN", "READY with no regime reads as 'the regime is fine'");
  assert.ok(result.reasons.includes("REGIME_UNKNOWN"), `reasons were ${JSON.stringify(result.reasons)}`);
  assert.equal(result.regime, undefined);
  assert.equal(result.strategyPolicy, undefined, "no policy granted exposure, so none may be reported");
});

test("abstaining on the regime does not discard the fused signal", () => {
  // The caller needs the fusion output regardless; abstaining is about authority, not data.
  const result = runIntelligenceEngineV10({ now: NOW, observations: [observation(NOW)] });
  assert.ok(result.fused != null);
  assert.equal(result.generatedAt, NOW);
});

test("a stale-only observation set abstains for both reasons, not one", () => {
  const result = runIntelligenceEngineV10({ now: NOW, observations: [] });
  assert.equal(result.status, "ABSTAIN");
  assert.deepEqual([...result.reasons].sort(), ["INSUFFICIENT_FRESH_INTELLIGENCE", "REGIME_UNKNOWN"]);
});

test("a known regime still decides on its own merits", () => {
  const features = Object.freeze({
    observedAt: NOW,
    trendStrength: 0.9,
    realizedVolatility: 0.1,
    volatilityPercentile: 0.2,
    liquidityScore: 0.9,
    drawdownFromPeak: 0.01
  });
  const result = runIntelligenceEngineV10({ now: NOW, observations: [observation(NOW)], regimeFeatures: features });
  assert.ok(result.regime != null, "a supplied regime must be classified, not skipped");
  assert.equal(result.reasons.includes("REGIME_UNKNOWN"), false);
  assert.ok(["READY", "ABSTAIN"].includes(result.status));
});

test("the stated rule this enforces is still stated", () => {
  // If the repository ever stops claiming to fail closed on uncertainty, this test is the wrong
  // shape and should be revisited rather than quietly satisfied.
  for (const document of ["README.md", "docs/PIPELINE_TO_CODE.md"]) {
    assert.match(readFileSync(join(ROOT, document), "utf8"), /[Ff]ail closed on uncertainty/);
  }
});
