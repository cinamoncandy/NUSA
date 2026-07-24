const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { loadStrategyChoice, saveStrategyChoice, loadStrategyPeriods, saveStrategyPeriods } = require("../dist/apps/server/src/strategyChoiceStore.js");

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

test("saveStrategyPeriods/loadStrategyPeriods round-trip", () => {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-strategy-choice-"));
  const path = join(dir, "periods.json");
  try {
    assert.equal(loadStrategyPeriods(path), undefined);
    saveStrategyPeriods(path, { shortPeriod: 7, longPeriod: 25 });
    assert.deepEqual(loadStrategyPeriods(path), { shortPeriod: 7, longPeriod: 25 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saving choice and periods to the same file preserves both (read-modify-write, not overwrite)", () => {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-strategy-choice-"));
  const path = join(dir, "combined.json");
  try {
    saveStrategyChoice(path, "ema-crossover");
    saveStrategyPeriods(path, { shortPeriod: 10, longPeriod: 30 });
    assert.equal(loadStrategyChoice(path), "ema-crossover", "periods save must not clobber the choice");
    assert.deepEqual(loadStrategyPeriods(path), { shortPeriod: 10, longPeriod: 30 });

    saveStrategyChoice(path, "sma-crossover");
    assert.deepEqual(loadStrategyPeriods(path), { shortPeriod: 10, longPeriod: 30 }, "choice save must not clobber periods");
    assert.equal(loadStrategyChoice(path), "sma-crossover");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadStrategyPeriods rejects non-integer or invalid-ordering periods", () => {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-strategy-choice-"));
  const path = join(dir, "invalid.json");
  const { writeFileSync } = require("node:fs");
  try {
    writeFileSync(path, JSON.stringify({ shortPeriod: 5.5, longPeriod: 20 }), "utf8");
    assert.equal(loadStrategyPeriods(path), undefined, "non-integer shortPeriod");
    writeFileSync(path, JSON.stringify({ shortPeriod: 20, longPeriod: 5 }), "utf8");
    assert.equal(loadStrategyPeriods(path), undefined, "longPeriod must exceed shortPeriod");
    writeFileSync(path, JSON.stringify({ shortPeriod: 1, longPeriod: 20 }), "utf8");
    assert.equal(loadStrategyPeriods(path), undefined, "shortPeriod must be at least 2");
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
