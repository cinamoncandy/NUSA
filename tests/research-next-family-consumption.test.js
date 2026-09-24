"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/**
 * PAPER Learning Closed-Loop preflight: the learning evidence ordered the precommitted research
 * families for the next run (unexplored first), but it was only printed. The next run read only
 * NUSA_RESEARCH_STRATEGY_FAMILY, defaulting to SMA, so production re-evaluated the same 9 SMA
 * cells daily and the precommitted RSI and Donchian families were never evaluated. The next run
 * now consumes the persisted learning order.
 */
const run = require("../scripts/research-real-market-run.js");

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-next-family-"));
  return path.join(dir, "research-next-family.json");
}

test("the next run consumes the learning-ordered family when none is set explicitly", () => {
  const file = tempFile();
  run.writeNextResearchFamily(file, "rsi-mean-reversion", 9, "2026-09-24T00:00:00.000Z");
  const learned = run.readNextResearchFamily(file);
  assert.equal(learned, "rsi-mean-reversion");
  assert.equal(run.researchStrategyFamily(undefined, learned), "rsi-mean-reversion");
});

test("an explicit family still wins, and SMA remains the default without learning evidence", () => {
  assert.equal(run.researchStrategyFamily("donchian-breakout", "rsi-mean-reversion"), "donchian-breakout");
  assert.equal(run.researchStrategyFamily(undefined, null), "sma-crossover");
  assert.equal(run.researchStrategyFamily("", null), "sma-crossover");
});

test("a missing, corrupt or unsupported learning file is ignored, never trusted", () => {
  const file = tempFile();
  assert.equal(run.readNextResearchFamily(file), null);
  fs.writeFileSync(file, "{not json");
  assert.equal(run.readNextResearchFamily(file), null);
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, nextFamily: "invented-family" }));
  assert.equal(run.readNextResearchFamily(file), null);
  assert.throws(() => run.writeNextResearchFamily(file, "invented-family", 0, "x"), /unsupported/);
});

test("only precommitted families can ever be selected", () => {
  assert.deepEqual([...run.SUPPORTED_RESEARCH_FAMILIES], ["sma-crossover", "rsi-mean-reversion", "donchian-breakout"]);
  assert.throws(() => run.researchStrategyFamily("invented-family", null), /unsupported/);
});
