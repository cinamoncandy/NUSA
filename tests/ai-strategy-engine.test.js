const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseNaturalLanguageStrategy,
  validateStrategy,
  StrategyRegistry,
  StrategyRegistryError,
  evaluatePaperExecutionBoundary
} = require("../dist/apps/mobile/src/aiStrategyEngine.js");

const source = "Buy when SMA 5 crosses above SMA 20 on KRW-BTC in sideways, take profit 5%, stop loss 2%, risk 1%, position size 10%, max position 100000";
const options = { strategyId: "sma-paper", name: "SMA Paper", version: "1.0.0", now: 100, datasetVersion: "paper-ai-v1", datasetChecksum: "a".repeat(64) };

test("parses natural language into deterministic, evidence-backed Draft DSL", () => {
  const first = parseNaturalLanguageStrategy(source, options);
  const second = parseNaturalLanguageStrategy(source, options);
  assert.equal(first.status, "DRAFT");
  assert.deepEqual(first, second);
  assert.equal(first.strategy.dsl.entry.type, "SMA_CROSSOVER");
  assert.deepEqual(first.strategy.dsl.scope, { symbols: ["KRW-BTC"], regimes: ["SIDEWAYS"] });
  assert.equal(first.strategy.paperOnly, true);
  assert.equal(first.strategy.productionMutationAllowed, false);
  assert.match(first.strategy.evidence.generationReasons.join("|"), /dataset:paper-ai-v1/);
});

test("validates a complete strategy and rejects incomplete or live-oriented input", () => {
  const parsed = parseNaturalLanguageStrategy(source, options);
  const valid = validateStrategy(parsed.strategy);
  assert.equal(valid.status, "VALIDATED");
  assert.equal(valid.strategy.status, "VALIDATED");
  const incomplete = parseNaturalLanguageStrategy("trade KRW-BTC when RSI is low");
  assert.equal(incomplete.status, "REJECTED");
  assert.ok(incomplete.errors.includes("STOP_LOSS_REQUIRED"));
  const live = parseNaturalLanguageStrategy(`${source} and use live trading`);
  assert.equal(live.status, "REJECTED");
  assert.ok(live.errors.includes("LIVE_MUTATION_LANGUAGE_UNSUPPORTED"));
});

test("registry stores only validated versions and is idempotent", () => {
  const parsed = parseNaturalLanguageStrategy(source, options);
  const validated = validateStrategy(parsed.strategy).strategy;
  const registry = new StrategyRegistry();
  assert.equal(registry.register(validated), registry.register(validated));
  assert.equal(registry.latest("sma-paper").version, "1.0.0");
  assert.equal(registry.list("sma-paper").length, 1);
  assert.throws(() => registry.register(parsed.strategy), (error) => error instanceof StrategyRegistryError && error.code === "INVALID_STRATEGY");
  assert.throws(() => registry.register({ ...validated, name: "tampered" }), (error) => error instanceof StrategyRegistryError && error.code === "VERSION_CONFLICT");
});

test("paper boundary fails closed and never grants order authority", () => {
  const parsed = parseNaturalLanguageStrategy(source, options);
  const validated = validateStrategy(parsed.strategy).strategy;
  const base = { mode: "PAPER", marketDataHealthy: true, recoveryReady: true, riskHealthy: true };
  assert.deepEqual(evaluatePaperExecutionBoundary(validated, base), { allowed: true, reason: "PAPER_EVALUATION_ALLOWED", productionMutationAllowed: false, orderAuthority: false });
  assert.equal(evaluatePaperExecutionBoundary(validated, { ...base, mode: "LIVE" }).allowed, false);
  assert.equal(evaluatePaperExecutionBoundary({ ...validated, status: "DRAFT" }, base).reason, "STRATEGY_NOT_VALIDATED");
  assert.equal(evaluatePaperExecutionBoundary(validated, { ...base, recoveryReady: false }).reason, "RECOVERY_NOT_READY");
});
