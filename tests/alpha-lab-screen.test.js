"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { CUTOFF_EXCLUSIVE, canonicalJson, parseRowsBeforeCutoff, screen, validateGrammar } = require("../scripts/alpha-lab/screen.js");

const markets = ["KRW-BTC", ...Array.from({ length: 19 }, (_, i) => `KRW-M${String(i).padStart(2, "0")}`)].sort();
const grammar = {
  schemaVersion: 1,
  declaredAtUtc: "2026-11-28T00:00:00.000Z",
  k: 6,
  minHistoryDays: 90,
  universe: markets,
  families: [
    { id: "SIZE_REV_H7", kind: "SIZE_REV", holdDays: 7, parameters: { turnoverLookbackDays: 30, pickFraction: 0.5, returnLookbackDays: 7 } },
    { id: "LISTING_AGE_H7", kind: "LISTING_AGE", holdDays: 7, parameters: { minAgeDays: 90, maxAgeDays: 240, returnLookbackDays: 28 } },
    { id: "FRIDAY_MOMENTUM_H3", kind: "WEEKDAY_XS", holdDays: 3, parameters: { utcWeekday: 5, returnLookbackDays: 3 } },
    { id: "BTC_BETA_ROT_H7", kind: "BTC_BETA_ROT", holdDays: 7, parameters: { betaLookbackDays: 60, btcTrendLookbackDays: 20 } },
    { id: "VOL_COMPRESS_BREAK_H5", kind: "VOL_COMPRESS_BREAK", holdDays: 5, parameters: { rangeDays: 10, historyDays: 120, quantile: 0.2, breakoutDays: 10, volumeLookbackDays: 20 } },
    { id: "DOWNVOL_LOW_H14", kind: "DOWNVOL_LOW", holdDays: 14, parameters: { lookbackDays: 60, minimumDownDays: 5 } },
  ],
};

function fixtureRows(marketIndex, count = 673) {
  const start = Date.parse("2025-01-01T00:00:00.000Z");
  const rows = [];
  for (let day = 0; day < count; day++) {
    const close = 100 + marketIndex * 0.7 + day * 0.025 + ((day * 7 + marketIndex) % 11) * 0.013;
    rows.push([
      start + day * 86_400_000,
      close * 0.999,
      close * 1.01,
      close * 0.99,
      close,
      1_000 + marketIndex * 5 + day,
    ]);
  }
  return rows;
}

function makeInput() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-lab-screen-"));
  markets.forEach((market, i) => fs.writeFileSync(path.join(dir, `${market}.json`), `${JSON.stringify(fixtureRows(i))}\n`));
  const grammarBytes = Buffer.from(`${canonicalJson(grammar)}\n`, "utf8");
  return { dir, grammarBytes, grammar: JSON.parse(grammarBytes.toString("utf8")) };
}

test("grammar is frozen, bounded, and K covers every declared family", () => {
  assert.equal(validateGrammar(grammar), grammar);
  assert.throws(() => validateGrammar({ ...grammar, k: 0 }), /GRAMMAR_K_INVALID/);
  assert.throws(() => validateGrammar({ ...grammar, k: 0, families: [{ ...grammar.families[0], id: "SECOND" }] }), /GRAMMAR_K_INVALID/);
  assert.throws(() => validateGrammar({ ...grammar, universe: [...markets].reverse() }), /GRAMMAR_UNIVERSE_NOT_SORTED/);
});

test("daily parser rejects the reserved date before parsing its OHLCV payload", () => {
  const ts = CUTOFF_EXCLUSIVE;
  assert.throws(() => parseRowsBeforeCutoff(`[[${ts},this-is-not-valid-json]]`), /DATA_DATE_AFTER_CUTOFF/);
  const allowed = parseRowsBeforeCutoff(`[[${ts - 86_400_000},1,2,0.5,1.5,10]]`);
  assert.equal(allowed.length, 1);
  assert.throws(() => parseRowsBeforeCutoff(`[[${ts - 86_400_000},1,2,0.5,1.5,10],[${ts},ignored]]`), /DATA_DATE_AFTER_CUTOFF/);
});

test("same declared grammar and bounded inputs produce identical hashed summaries", () => {
  const input = makeInput();
  try {
    const first = screen({ grammar: input.grammar, grammarBytes: input.grammarBytes, inputDir: input.dir });
    const second = screen({ grammar: input.grammar, grammarBytes: input.grammarBytes, inputDir: input.dir });
    assert.deepEqual(first, second);
    assert.equal(first.rulesTested, 6);
    assert.equal(first.declaredK, 6);
    assert.equal(first.dataEndDateUtc, "2026-11-04");
    assert.equal(first.cutoffDateUtc, "2026-11-04");
    assert.equal(first.disclosures.historyWasAlreadyRead, true);
    assert.equal(first.disclosures.currentMarketUniverseSurvivorshipBias, true);
    assert.equal(first.disclosures.fillAtSignalCloseIsOptimistic, true);
    const { outputSha256, ...content } = first;
    const expected = crypto.createHash("sha256").update(`${canonicalJson(content)}\n`).digest("hex");
    assert.equal(outputSha256, expected);
    assert.match(first.sourceFiles[0].sourceSha256, /^[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(input.dir, { recursive: true, force: true });
  }
});

test("input market list must exactly match the declared sorted universe", () => {
  const input = makeInput();
  try {
    const wrongUniverse = { ...input.grammar, universe: input.grammar.universe.slice(1) };
    const wrongUniverseBytes = Buffer.from(`${canonicalJson(wrongUniverse)}\n`, "utf8");
    assert.throws(() => screen({ grammar: wrongUniverse, grammarBytes: wrongUniverseBytes, inputDir: input.dir }), /DATA_UNIVERSE_MISMATCH/);
  } finally {
    fs.rmSync(input.dir, { recursive: true, force: true });
  }
});

test("market rows must be sorted UTC daily OHLCV with finite positive prices", () => {
  const rows = fixtureRows(0, 2);
  assert.throws(() => parseRowsBeforeCutoff(JSON.stringify([rows[1], rows[0]])), /DATA_ROWS_NOT_STRICTLY_SORTED/);
  assert.throws(() => parseRowsBeforeCutoff(JSON.stringify([[rows[0][0], 1, 0.5, 1, 1, 1]])), /DATA_ROW_VALUE_INVALID/);
});
