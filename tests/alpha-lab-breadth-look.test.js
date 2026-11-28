"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  FIRST_HELD_DAY,
  FIRST_SIGNAL_DAY,
  LOOKS,
  MARKETS,
  addDays,
  assertLookTime,
  buildSeries,
  evaluateLook,
  hashedEnvelope,
  runLook,
  serializeJson,
  sha256,
} = require("../scripts/alpha-lab/breadth-look.js");

function makeReturns(parts) {
  return parts.flatMap(([days, value]) => Array(days).fill(value));
}

function makeCandles(returns, { marketCount = MARKETS.length, historyDays = 150, initialClose = 100 } = {}) {
  const candlesByMarket = new Map();
  const historyStart = addDays(FIRST_SIGNAL_DAY, -(historyDays - 1));
  for (const market of MARKETS.slice(0, marketCount)) {
    let close = initialClose;
    const candles = new Map();
    for (let index = 0; index < historyDays; index += 1) {
      const date = addDays(historyStart, index);
      if (index > 0) close *= 1.001;
      candles.set(date, close);
    }
    for (let index = 0; index < returns.length; index += 1) {
      close *= 1 + returns[index];
      candles.set(addDays(FIRST_HELD_DAY, index), close);
    }
    candlesByMarket.set(market, candles);
  }
  return candlesByMarket;
}

function makeFlatCandles(heldDays, options) {
  return makeCandles(Array(heldDays).fill(0), options);
}

function buildAtLook(candles, lookName) {
  return buildSeries(candles, lookName);
}

function makeLookFixture(directory, fetchedAt, candlesByMarket) {
  const candleDirectory = path.join(directory, "candles");
  fs.mkdirSync(candleDirectory, { recursive: true });
  const files = [];
  for (const market of MARKETS) {
    const candles = candlesByMarket.get(market) || new Map();
    const rows = [...candles.entries()].map(([date, close]) => ({ date, close }));
    const buffer = Buffer.from(serializeJson(rows));
    const file = `candles/${market}.json`;
    fs.writeFileSync(path.join(directory, file), buffer);
    files.push({ market, file, sha256: sha256(buffer) });
  }
  const manifest = hashedEnvelope({ schemaVersion: 1, fetchedAt, source: "synthetic-test", files });
  fs.writeFileSync(path.join(directory, "manifest.json"), serializeJson(manifest));
}

test("registered market set is fixed and unique", () => {
  assert.equal(MARKETS.length, 56);
  assert.equal(new Set(MARKETS).size, MARKETS.length);
  assert.equal(MARKETS.includes("KRW-BTC"), true);
});
test("date guard refuses each registered look until its run time", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(LOOKS.L30.runAt) - 1 });
  for (const [lookName, look] of Object.entries(LOOKS)) {
    const runAt = Date.parse(look.runAt);
    t.mock.timers.setTime(runAt - 1);
    assert.throws(() => assertLookTime(lookName), /LOOK_NOT_YET_OPEN/);
    t.mock.timers.setTime(runAt);
    assert.equal(assertLookTime(lookName), look);
  }
});

test("early look command checks the date before reading its directory", (t) => {
  const absentDirectory = path.join(os.tmpdir(), "nusa-breadth-look-missing-input");
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(LOOKS.L30.runAt) - 1 });
  assert.throws(() => runLook(absentDirectory, "L30"), /LOOK_NOT_YET_OPEN/);
});

test("a second look in the same data directory is refused", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-breadth-look-once-"));
  try {
    const now = Date.parse("2027-01-05T04:00:00.000Z");
    t.mock.timers.enable({ apis: ["Date"], now });
    const candles = makeFlatCandles(LOOKS.L30.heldDays);
    makeLookFixture(directory, new Date(now).toISOString(), candles);
    const first = runLook(directory, "L30");
    assert.equal(fs.existsSync(first.resultPath), true);
    assert.equal(Object.hasOwn(first.envelope.payload, "metrics"), false);
    assert.throws(() => runLook(directory, "L30"), /LOOK_RESULT_ALREADY_EXISTS/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("synthetic L90 path pins all seven registered conditions and the fixed placebo count", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(LOOKS.L90.runAt) });
  const returns = makeReturns([
    [20, 0.02],
    [7, -0.04],
    [20, 0.02],
    [43, -0.04],
  ]);
  const days = buildAtLook(makeCandles(returns), "L90");
  const result = evaluateLook(days, "L90");
  assert.equal(result.outcome, "FAIL");
  assert.equal(result.decisive, true);
  assert.deepEqual(result.conditions, {
    condition1: true,
    condition2: true,
    condition3: true,
    condition4: true,
    condition5: false,
    condition6: true,
    condition7: true,
  });
  assert.equal(result.metrics.placeboSchedules, 10000);
  assert.equal(result.metrics.placeboWins, 8278);
  assert.equal(result.stage, "STUDY_ENDS_AT_L90");
  assert.equal(result.provisional, false);
});

test("fewer than ten eligible markets force a held day to cash", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(LOOKS.L30.runAt) });
  const days = buildAtLook(makeFlatCandles(LOOKS.L30.heldDays, { marketCount: 9 }), "L30");
  assert.equal(days[0].eligibleCount, 9);
  assert.equal(days[0].available, false);
  assert.equal(days[0].invested, false);
  assert.equal(days[0].dailyReturn, 0);
});

test("early no-information rule takes precedence when benchmark drawdown is below ten percent", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(LOOKS.L30.runAt) });
  const days = buildAtLook(makeFlatCandles(LOOKS.L30.heldDays), "L30");
  const result = evaluateLook(days, "L30");
  assert.equal(result.outcome, "NO_INFORMATION_YET");
  assert.equal(result.reason, "BENCHMARK_DRAWDOWN_BELOW_EARLY_THRESHOLD");
  assert.equal(result.decisive, false);
});

test("L60 early rule rejects low activity only after a meaningful benchmark drawdown", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(LOOKS.L60.runAt) });
  const returns = [-0.2, ...Array(59).fill(-0.01)];
  const result = evaluateLook(buildAtLook(makeCandles(returns), "L60"), "L60");
  assert.equal(result.outcome, "FAIL_EARLY");
  assert.equal(result.reason, "FILTER_ACTIVITY_BELOW_EARLY_THRESHOLD");
});

test("L90 is not informative when fewer than 75 signal days have ten eligible markets", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(LOOKS.L90.runAt) });
  const returns = makeReturns([
    [20, 0.02],
    [7, -0.04],
    [20, 0.02],
    [43, -0.04],
  ]);
  const candles = makeCandles(returns);
  const lastAvailableHeldDay = addDays(FIRST_HELD_DAY, 73);
  for (const marketCandles of candles.values()) marketCandles.delete(lastAvailableHeldDay);
  const result = evaluateLook(buildAtLook(candles, "L90"), "L90");
  assert.equal(result.outcome, "NOT_INFORMATIVE");
  assert.equal(result.decisive, false);
  assert.equal(result.metrics.eligibleSignalDays, 74);
  assert.ok(result.metrics.benchmark.maxDrawdown >= 0.2);
  assert.equal(result.stage, "CONTINUES_TO_L183");
});

test("look refuses a pre-deadline fetch manifest before reading candle files", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-breadth-look-early-manifest-"));
  try {
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse(LOOKS.L30.runAt) });
    fs.writeFileSync(path.join(directory, "manifest.json"), serializeJson(hashedEnvelope({
      schemaVersion: 1,
      fetchedAt: new Date(Date.parse(LOOKS.L30.runAt) - 1).toISOString(),
      source: "synthetic-test",
      files: [],
    })));
    assert.throws(() => runLook(directory, "L30"), /LOOK_REQUIRES_POST_RUN_FETCH/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
