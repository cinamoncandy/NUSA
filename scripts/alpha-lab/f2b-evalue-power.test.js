"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const test = require("node:test");

const sourcePath = path.join(__dirname, "f2b-evalue-power.js");
const source = fs.readFileSync(sourcePath, "utf8");
const f2b = require(sourcePath);

test("block score uses equal per-day IC across the predeclared holds", () => {
  for (const holdDays of [1, 5, 20]) {
    assert.ok(Math.abs(f2b.blockCorrelationForDailyIc(0.04, holdDays) / Math.sqrt(holdDays) - 0.04) < 1e-12);
  }
  assert.throws(() => f2b.blockCorrelationForDailyIc(0.3, 20), /BLOCK_CORRELATION_INVALID/);
});

test("adaptive bet is bounded and depends only on the supplied past sequence", () => {
  const past = [-0.2, -0.1];
  const beforeCurrentObservation = f2b.adaptiveLambdaFromPast(past);
  const withAdditionalPastAfterASeparateDecision = f2b.adaptiveLambdaFromPast([...past, 0.99]);
  assert.ok(beforeCurrentObservation >= 0 && beforeCurrentObservation < 1);
  assert.notEqual(beforeCurrentObservation, withAdditionalPastAfterASeparateDecision);
  assert.equal(f2b.adaptiveLambdaFromPast([-0.2, -0.1]), 0);
  assert.throws(() => f2b.adaptiveLambdaFromPast([1.01]), /ADAPTIVE_HISTORY_INVALID/);
});

test("every configured wager preserves nonnegative factors on the clipped domain", () => {
  for (const variant of f2b.VARIANTS) {
    const lambdas = variant.kind === "adaptive" ? [variant.maximumLambda] : variant.lambdas;
    assert.ok(lambdas.every((lambda) => lambda >= 0 && lambda < 1));
    for (const y of [-1, -0.5, 0, 0.5, 1]) {
      for (const lambda of lambdas) assert.ok(1 + lambda * y >= 0);
    }
  }
});

test("fixed seed reproduces a small synthetic path and its process evaluation", () => {
  const config = { ...f2b.PRIMARY_CONFIG, markets: 12, days: 40, burnInDays: 5, topMarkets: 4 };
  const input = { dailyIc: 0.04, holdDays: 5, innovationShape: "symmetric-t4", costOn: true, config };
  const first = f2b.generateExcessPath({ ...input, random: seedRandom(7) });
  const second = f2b.generateExcessPath({ ...input, random: seedRandom(7) });
  assert.deepEqual(Array.from(first.excess), Array.from(second.excess));
  const evaluatedA = f2b.evaluateEProcess(first.excess, f2b.VARIANTS[0], config);
  const evaluatedB = f2b.evaluateEProcess(second.excess, f2b.VARIANTS[0], config);
  assert.deepEqual(evaluatedA, evaluatedB);
});

test("final partial hold block generates the full forecast horizon", () => {
  const config = { ...f2b.PRIMARY_CONFIG, markets: 1, days: 21, topMarkets: 1 };
  let randomDraws = 0;
  const result = f2b.generateExcessPath({
    random: () => { randomDraws += 1; return 0.5; },
    dailyIc: 0.04,
    holdDays: 20,
    innovationShape: "symmetric-t4",
    costOn: false,
    config,
  });
  assert.equal(result.excess.length, 21);
  assert.equal(randomDraws, 614);
});

test("e-process records first crossing while clipped-mean diagnostic covers the full path", () => {
  const config = { ...f2b.PRIMARY_CONFIG, burnInDays: 20 };
  const excess = Float64Array.from([
    ...Array.from({ length: 20 }, (_, index) => index % 2 === 0 ? -1 : 1),
    ...Array(30).fill(100),
    ...Array(50).fill(-100),
  ]);
  const result = f2b.evaluateEProcess(excess, f2b.VARIANTS[0], config);
  assert.ok(result.passDay !== null && result.passDay < excess.length);
  assert.ok(result.meanClippedYAfterBurnIn < 0.5);
});

test("self-test is safe to call and the primary runner is not executed on import", () => {
  assert.deepEqual(f2b.selfTest(), { pass: true, assertions: 46, networkOrMarketData: false });
  assert.equal(f2b.PRIMARY_OUTPUT_PATH, path.resolve(__dirname, "../../docs/research-data/alpha-lab-f2b-evalue-power-2026-11-28.json"));
  const importCheck = spawnSync(process.execPath, ["-e", "require(process.argv[1])", sourcePath], { encoding: "utf8" });
  assert.equal(importCheck.status, 0);
  assert.equal(importCheck.stdout, "");
  const arbitraryTarget = path.join(os.tmpdir(), `alpha-lab-f2b-${randomUUID()}.json`);
  const rejectedPrimary = spawnSync(process.execPath, [sourcePath, "--primary", arbitraryTarget], { encoding: "utf8" });
  assert.equal(rejectedPrimary.status, 1);
  assert.match(rejectedPrimary.stderr, /CLI_ARGUMENTS_INVALID/);
  assert.equal(fs.existsSync(arbitraryTarget), false);
  assert.match(source, /require\("node:crypto"\)/);
  assert.doesNotMatch(source, /require\("(?:https?|undici|ws)"\)/);
  assert.doesNotMatch(source, /fetch\s*\(|https?\.request\s*\(/);
  assert.doesNotMatch(source, /cloudPaperExecutionBoundary|paperTradingExecutionLoop|brokerAdapter/i);
});

function seedRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
