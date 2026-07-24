const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { loadStrategyChoice, saveStrategyChoice } = require("../dist/apps/server/src/strategyChoiceStore.js");

test("saveStrategyChoice/loadStrategyChoice round-trip", () => {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-strategy-choice-"));
  const path = join(dir, "nested", "choice.json");
  try {
    assert.equal(loadStrategyChoice(path), undefined);
    saveStrategyChoice(path, "ema-crossover");
    assert.equal(loadStrategyChoice(path), "ema-crossover");
    saveStrategyChoice(path, "sma-crossover");
    assert.equal(loadStrategyChoice(path), "sma-crossover");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadStrategyChoice ignores malformed or unknown content instead of throwing", () => {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-strategy-choice-"));
  const path = join(dir, "choice.json");
  const { writeFileSync } = require("node:fs");
  try {
    writeFileSync(path, "not json", "utf8");
    assert.equal(loadStrategyChoice(path), undefined);
    writeFileSync(path, JSON.stringify({ choice: "macd-cross" }), "utf8");
    assert.equal(loadStrategyChoice(path), undefined);
    writeFileSync(path, JSON.stringify({}), "utf8");
    assert.equal(loadStrategyChoice(path), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
