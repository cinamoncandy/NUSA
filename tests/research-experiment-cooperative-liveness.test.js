const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const { ResearchExperimentOrchestrator } = require("../dist/apps/cloud/src/researchExperimentOrchestrator.js");
const { researchSessionIdFor } = require("../dist/apps/cloud/src/researchSessionPlanner.js");

const NOW = Date.UTC(2026, 9, 19, 10, 0, 0);
const M = 60_000;

function variant(variantId) {
  return {
    variantId,
    champion: { strategy: { strategyId: `champion-${variantId}`, version: "1.0.0" }, config: {} },
    challenger: { strategy: { strategyId: `challenger-${variantId}`, version: "1.0.0" }, config: {} },
    runtime: {
      recover: () => ({ status: "READY", snapshot: null, reasons: [] }),
      status: () => { throw new Error("not used"); },
      startSession: () => { throw new Error("today's session already exists"); },
      runExperiment: () => { throw new Error("no closed candle is due"); },
      resume: () => { throw new Error("not paused"); },
      stop: () => { throw new Error("not stale"); },
    },
  };
}

function buildOrchestrator() {
  const variants = [variant("v1"), variant("v2"), variant("v3")];
  const sessions = new Map(variants.map(({ variantId }) => {
    const sessionId = researchSessionIdFor(NOW, variantId);
    return [sessionId, { sessionId, state: "RUNNING" }];
  }));
  return new ResearchExperimentOrchestrator({
    variants,
    sessions: { list: () => [...sessions.values()], load: (sessionId) => sessions.get(sessionId) },
    markets: ["KRW-BTC"],
    intervalMs: M,
    windows: { intervalMs: M, trainMs: M, validationMs: M, holdoutMs: M, maxMissingRatio: 0 },
    dailyBudgetPerVariant: 3,
    collect: () => {},
    candles: { read: () => [], latestCloseTime: () => undefined },
    holdout: { claim: () => "CLAIMED", overlapsUsedHoldout: () => false },
    now: () => NOW,
    sourceCommitSha: "a".repeat(40),
    models: { fill: "fill", fee: "fee", slippage: "slippage" },
    evaluator: { version: "test", modelVersion: "test" },
    featurePipeline: { version: "test", config: {} },
    experimentFamilyPrefix: "test-family",
  });
}

test("cooperative Research tick yields between bounded variant/market steps without changing the report", async () => {
  const orchestrator = buildOrchestrator();
  assert.equal(orchestrator.recover().status, "READY");
  let yields = 0;
  const report = await orchestrator.tickAsync(async () => {
    yields += 1;
    await new Promise((resolve) => setImmediate(resolve));
  });
  assert.equal(report.status, "OK");
  assert.equal(report.experiments.length, 3);
  assert.ok(report.experiments.every((entry) => entry.outcome.status === "NOT_DUE"));
  assert.equal(yields, 4, "one post-collection yield plus one yield after each bounded variant/market step");
});

test("production Research timers use the cooperative scheduler, not the synchronous tick path", () => {
  const source = readFileSync(join(process.cwd(), "apps/cloud/src/researchExperimentComposition.ts"), "utf8");
  assert.match(source, /first = setTimeout\(scheduleTick, 60_000\)/);
  assert.match(source, /timer = setInterval\(scheduleTick, settings\.tickMs\)/);
  assert.match(source, /await orchestrators\[index\]!\.tickAsync\(yieldProductionTurn\)/);
  assert.doesNotMatch(source, /setTimeout\(\(\) => \{ try \{ tickOnce\(\)/);
});
