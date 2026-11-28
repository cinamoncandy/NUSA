#!/usr/bin/env node
"use strict";

// Registered forward breadth study. The market set and every decision rule are
// frozen to the pre-registration and its staged-looks amendment. This tool has
// no order path and never reads the historical discovery snapshot at runtime.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_SIGNAL_DAY = "2026-12-05";
const FIRST_HELD_DAY = "2026-12-06";
const UPBIT_DAILY_CANDLES = "https://api.upbit.com/v1/candles/days";
const PAGE_SIZE = 200;
const MIN_HISTORY_CANDLES = 90;
const MIN_ELIGIBLE_MARKETS = 10;
const SEED = 20261206;
const PLACEBO_SCHEDULES = 10000;
const COST_RATE = 0.0015;
const STRESS_COST_RATE = 0.003;

// Static membership copied from the registered discovery/forward pool union,
// with KRW-BTC added as required by the pre-registration.
const MARKETS = Object.freeze([
  "KRW-1INCH", "KRW-A", "KRW-AAVE", "KRW-ADA", "KRW-AHT", "KRW-APT", "KRW-ARB", "KRW-ARK", "KRW-ATOM", "KRW-AVAX",
  "KRW-AWE", "KRW-AXS", "KRW-BCH", "KRW-BSV", "KRW-BTC", "KRW-CBK", "KRW-CELO", "KRW-DKA", "KRW-DOT", "KRW-EGLD",
  "KRW-ETC", "KRW-ETH", "KRW-FCT2", "KRW-GAME2", "KRW-GAS", "KRW-GMT", "KRW-HIVE", "KRW-HUNT", "KRW-IQ", "KRW-KAVA",
  "KRW-KNC", "KRW-LINK", "KRW-LSK", "KRW-MANA", "KRW-MASK", "KRW-MTL", "KRW-MVL", "KRW-NEAR", "KRW-NEO", "KRW-ORBS",
  "KRW-POL", "KRW-PUNDIX", "KRW-QTUM", "KRW-SAND", "KRW-SC", "KRW-SHIB", "KRW-SOL", "KRW-STRAX", "KRW-STX", "KRW-TFUEL",
  "KRW-THETA", "KRW-TOKAMAK", "KRW-WAVES", "KRW-XEC", "KRW-XRP", "KRW-XTZ",
]);

const LOOKS = Object.freeze({
  L30: Object.freeze({ heldDays: 30, lastHeldDay: "2027-01-04", runAt: "2027-01-05T03:00:00.000Z", early: true }),
  L60: Object.freeze({ heldDays: 60, lastHeldDay: "2027-02-03", runAt: "2027-02-04T03:00:00.000Z", early: true }),
  L90: Object.freeze({ heldDays: 90, lastHeldDay: "2027-03-05", runAt: "2027-03-07T03:00:00.000Z", early: false }),
  L183: Object.freeze({ heldDays: 183, lastHeldDay: "2027-06-06", runAt: "2027-06-07T03:00:00.000Z", early: false }),
});

const TWO32 = 0x100000000n;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function serializeJson(value) {
  return JSON.stringify(value, (_key, item) => {
    if (item === Infinity) return "Infinity";
    if (item === -Infinity) return "-Infinity";
    if (typeof item === "number" && !Number.isFinite(item)) return null;
    return item;
  }, 2) + "\n";
}

function hashedEnvelope(payload) {
  return { sha256: sha256(serializeJson(payload)), payload };
}

function verifyEnvelope(envelope, label) {
  if (!envelope || typeof envelope !== "object" || !envelope.payload || typeof envelope.payload !== "object") {
    throw new Error(`${label}_INVALID_ENVELOPE`);
  }
  const actual = sha256(serializeJson(envelope.payload));
  if (typeof envelope.sha256 !== "string" || actual !== envelope.sha256) throw new Error(`${label}_HASH_MISMATCH`);
  return envelope.payload;
}

function dateMs(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("INVALID_UTC_DAY");
  const result = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(result) || new Date(result).toISOString().slice(0, 10) !== date) throw new Error("INVALID_UTC_DAY");
  return result;
}

function addDays(date, amount) {
  return new Date(dateMs(date) + amount * DAY_MS).toISOString().slice(0, 10);
}

function assertLookName(lookName) {
  if (!Object.prototype.hasOwnProperty.call(LOOKS, lookName)) throw new Error("UNKNOWN_LOOK");
  return LOOKS[lookName];
}

function assertLookTime(lookName) {
  const look = assertLookName(lookName);
  if (Date.now() < Date.parse(look.runAt)) throw new Error("LOOK_NOT_YET_OPEN");
  return look;
}

function assertFetchTime() {
  if (Date.now() < Date.parse(LOOKS.L30.runAt)) throw new Error("FETCH_NOT_YET_OPEN");
}

function isClosedDay(date, fetchedAtMs) {
  return dateMs(date) + DAY_MS <= fetchedAtMs;
}

function normalizeCandle(candle) {
  if (!candle || typeof candle !== "object") return null;
  const rawDate = candle.candle_date_time_utc;
  const date = typeof rawDate === "string" ? rawDate.slice(0, 10) : candle.date;
  const close = typeof candle.trade_price === "number" ? candle.trade_price : candle.close;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) return null;
  dateMs(date);
  return { date, close };
}

function mulberry32(seed) {
  let state = seed | 0;
  return function nextUint32() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return (value ^ (value >>> 14)) >>> 0;
  };
}

function eligibleMarketsForSignal(marketCandles, signalDay, excludedMarkets = new Set()) {
  const signalMs = dateMs(signalDay);
  const startDay = addDays(signalDay, -49);
  const eligible = [];
  for (const market of MARKETS) {
    if (excludedMarkets.has(market)) continue;
    const candles = marketCandles.get(market);
    if (!candles) continue;
    const close = candles.get(signalDay);
    if (!Number.isFinite(close)) continue;
    let historyCount = 0;
    for (const day of candles.keys()) if (dateMs(day) <= signalMs) historyCount += 1;
    if (historyCount < MIN_HISTORY_CANDLES) continue;
    let sum = 0;
    let complete = true;
    for (let offset = 0; offset < 50; offset += 1) {
      const day = addDays(startDay, offset);
      const value = candles.get(day);
      if (!Number.isFinite(value)) {
        complete = false;
        break;
      }
      sum += value;
    }
    if (!complete) continue;
    eligible.push({ market, close, aboveAverage: close > sum / 50 });
  }
  return eligible;
}

function buildSeries(marketCandles, lookName, { excludedMarkets = new Set() } = {}) {
  assertLookTime(lookName);
  const look = assertLookName(lookName);
  const permanentlyExcluded = new Set(excludedMarkets);
  const days = [];
  for (let index = 0; index < look.heldDays; index += 1) {
    const signalDay = addDays(FIRST_SIGNAL_DAY, index);
    const heldDay = addDays(FIRST_HELD_DAY, index);
    const eligible = eligibleMarketsForSignal(marketCandles, signalDay, permanentlyExcluded);
    if (eligible.length < MIN_ELIGIBLE_MARKETS) {
      for (const item of eligible) {
        if (!Number.isFinite(marketCandles.get(item.market).get(heldDay))) permanentlyExcluded.add(item.market);
      }
      days.push({ signalDay, heldDay, eligibleCount: eligible.length, available: false, invested: false, dailyReturn: 0 });
      continue;
    }
    const breadth = eligible.filter((market) => market.aboveAverage).length / eligible.length;
    let sumReturn = 0;
    for (const item of eligible) {
      const nextClose = marketCandles.get(item.market).get(heldDay);
      if (!Number.isFinite(nextClose)) {
        // A missing D+1 candle is held flat for that day and removed thereafter.
        permanentlyExcluded.add(item.market);
      } else {
        sumReturn += nextClose / item.close - 1;
      }
    }
    days.push({
      signalDay,
      heldDay,
      eligibleCount: eligible.length,
      available: true,
      breadth,
      invested: breadth >= 0.5,
      dailyReturn: sumReturn / eligible.length,
    });
  }
  return days;
}

function equityCurve(days, mask, costRate, { benchmark = false } = {}) {
  if (!Array.isArray(days) || !Array.isArray(mask) || days.length !== mask.length) throw new Error("CURVE_INPUT_MISMATCH");
  let equity = 1;
  let previousPosition = 0;
  const values = [];
  for (let index = 0; index < days.length; index += 1) {
    const day = days[index];
    const wantsPosition = benchmark ? day.available : Boolean(mask[index] && day.available);
    if (benchmark && index === 0) equity *= 1 - costRate;
    if (!benchmark) equity *= 1 - costRate * Math.abs(Number(wantsPosition) - previousPosition);
    previousPosition = Number(wantsPosition);
    if (wantsPosition) equity *= 1 + day.dailyReturn;
    values.push(equity);
  }
  return values;
}

function curveStatistics(curve) {
  let peak = 1;
  let maxDrawdown = 0;
  for (const equity of curve) {
    if (equity > peak) peak = equity;
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, 1 - equity / peak);
  }
  const netReturn = (curve.length ? curve[curve.length - 1] : 1) - 1;
  const returnPerDrawdown = maxDrawdown > 0 ? netReturn / maxDrawdown : netReturn > 0 ? Infinity : -Infinity;
  return { netReturn, maxDrawdown, returnPerDrawdown };
}

function countValidSchedules(availability, index, investedRemaining, switchesRemaining, previousState, memo, firstState) {
  const key = `${index}|${investedRemaining}|${switchesRemaining}|${previousState}`;
  if (memo.has(key)) return memo.get(key);
  if (index === availability.length) {
    const result = investedRemaining === 0 && switchesRemaining === 0 ? 1n : 0n;
    memo.set(key, result);
    return result;
  }
  let total = 0n;
  for (const state of [0, 1]) {
    if (index === 0 && state !== firstState) continue;
    if (state === 1 && !availability[index]) continue;
    const nextInvested = investedRemaining - state;
    const nextSwitches = switchesRemaining - (index === 0 ? 0 : Number(state !== previousState));
    if (nextInvested < 0 || nextSwitches < 0) continue;
    total += countValidSchedules(availability, index + 1, nextInvested, nextSwitches, state, memo, firstState);
  }
  memo.set(key, total);
  return total;
}

function drawSchedule(availability, investedDays, switches, randomUint32, memo, firstState) {
  const total = countValidSchedules(availability, 0, investedDays, switches, 0, memo, firstState);
  if (total === 0n) throw new Error("NO_PLACEBO_SCHEDULES_MATCH_REGISTERED_COUNTS");
  const mask = [];
  let previousState = 0;
  let investedRemaining = investedDays;
  let switchesRemaining = switches;
  for (let index = 0; index < availability.length; index += 1) {
    // One raw 32-bit Mulberry32 draw is consumed per held-day step.
    const draw = BigInt(randomUint32());
    const choices = [];
    for (const state of [0, 1]) {
      if (index === 0 && state !== firstState) continue;
      if (state === 1 && !availability[index]) continue;
      const nextInvested = investedRemaining - state;
      const nextSwitches = switchesRemaining - (index === 0 ? 0 : Number(state !== previousState));
      if (nextInvested < 0 || nextSwitches < 0) continue;
      const ways = countValidSchedules(availability, index + 1, nextInvested, nextSwitches, state, memo, firstState);
      if (ways > 0n) choices.push({ state, ways, nextInvested, nextSwitches });
    }
    if (choices.length === 0) throw new Error("NO_PLACEBO_SCHEDULES_MATCH_REGISTERED_COUNTS");
    let stateChoice = choices[0];
    if (choices.length > 1) {
      const choiceTotal = choices.reduce((sum, choice) => sum + choice.ways, 0n);
      const ticket = draw * choiceTotal / TWO32;
      stateChoice = ticket < choices[0].ways ? choices[0] : choices[1];
    }
    mask.push(Boolean(stateChoice.state));
    previousState = stateChoice.state;
    investedRemaining = stateChoice.nextInvested;
    switchesRemaining = stateChoice.nextSwitches;
  }
  return mask;
}

function countSwitches(mask) {
  let count = 0;
  for (let index = 1; index < mask.length; index += 1) if (mask[index] !== mask[index - 1]) count += 1;
  return count;
}

function evaluateConditions(days, filteredCurve, benchmarkCurve, filteredStressCurve, benchmarkStressCurve) {
  const filter = curveStatistics(filteredCurve);
  const benchmark = curveStatistics(benchmarkCurve);
  const filteredStress = curveStatistics(filteredStressCurve);
  const benchmarkStress = curveStatistics(benchmarkStressCurve);
  const investedDays = days.reduce((count, day) => count + Number(day.invested), 0);
  const activity = days.length ? investedDays / days.length : 0;
  const switches = countSwitches(days.map((day) => day.invested));
  const availability = days.map((day) => day.available);
  const random = mulberry32(SEED);
  const memo = new Map();
  const firstState = days.length ? Number(days[0].invested) : 0;
  const filterMdd = curveStatistics(filteredCurve).maxDrawdown;
  let placeboWins = 0;
  for (let index = 0; index < PLACEBO_SCHEDULES; index += 1) {
    const schedule = drawSchedule(availability, investedDays, switches, random, memo, firstState);
    const placeboMdd = curveStatistics(equityCurve(days, schedule, COST_RATE)).maxDrawdown;
    if (filterMdd < placeboMdd) placeboWins += 1;
  }
  const conditions = {
    condition1: filter.maxDrawdown <= 0.7 * benchmark.maxDrawdown,
    condition2: benchmark.netReturn > 0 ? filter.netReturn >= 0.5 * benchmark.netReturn : filter.netReturn >= benchmark.netReturn,
    condition3: benchmark.netReturn > 0 && filter.netReturn > 0
      ? filter.returnPerDrawdown > benchmark.returnPerDrawdown
      : filter.netReturn >= benchmark.netReturn,
    condition4: filteredStress.netReturn >= benchmarkStress.netReturn,
    condition5: placeboWins >= 9500,
    condition6: activity >= 0.2 && activity <= 0.9,
    condition7: benchmark.netReturn >= 0 || filter.netReturn > -0.5 * Math.abs(benchmark.netReturn),
  };
  return {
    metrics: {
      filter,
      benchmark,
      stress: { filterNetReturn: filteredStress.netReturn, benchmarkNetReturn: benchmarkStress.netReturn },
      activity,
      investedDays,
      switches,
      placeboWins,
      placeboSchedules: PLACEBO_SCHEDULES,
      placeboSeed: SEED,
      placeboDrawsPerScheduleStep: days.length,
      eligibleSignalDays: days.reduce((count, day) => count + Number(day.available), 0),
    },
    conditions,
    allConditionsPass: Object.values(conditions).every(Boolean),
  };
}

function evaluateLook(days, lookName) {
  assertLookTime(lookName);
  const look = assertLookName(lookName);
  if (!Array.isArray(days) || days.length !== look.heldDays) throw new Error("LOOK_WINDOW_LENGTH_MISMATCH");
  const filteredMask = days.map((day) => Boolean(day.invested && day.available));
  const filteredCurve = equityCurve(days, filteredMask, COST_RATE);
  const benchmarkCurve = equityCurve(days, days.map(() => true), COST_RATE, { benchmark: true });
  const filteredStressCurve = equityCurve(days, filteredMask, STRESS_COST_RATE);
  const benchmarkStressCurve = equityCurve(days, days.map(() => true), STRESS_COST_RATE, { benchmark: true });
  const filter = curveStatistics(filteredCurve);
  const benchmark = curveStatistics(benchmarkCurve);
  const eligibleSignalDays = days.reduce((count, day) => count + Number(day.available), 0);

  if (look.early) {
    let outcome;
    let reason;
    if (benchmark.maxDrawdown < 0.1) {
      outcome = "NO_INFORMATION_YET";
      reason = "BENCHMARK_DRAWDOWN_BELOW_EARLY_THRESHOLD";
    } else if (filter.maxDrawdown >= benchmark.maxDrawdown) {
      outcome = "FAIL_EARLY";
      reason = "FILTER_DRAWDOWN_NOT_SMALLER_THAN_BENCHMARK";
    } else if (lookName === "L60" && days.filter((day) => day.invested).length / days.length < 0.1) {
      outcome = "FAIL_EARLY";
      reason = "FILTER_ACTIVITY_BELOW_EARLY_THRESHOLD";
    } else {
      outcome = "CONTINUE";
      reason = "EARLY_LOOK_DID_NOT_REJECT";
    }
    return { look: lookName, outcome, reason, stage: "EARLY_REJECT_ONLY", decisive: outcome === "FAIL_EARLY" };
  }

  const evaluated = evaluateConditions(days, filteredCurve, benchmarkCurve, filteredStressCurve, benchmarkStressCurve);
  const minimumEligibleDays = lookName === "L90" ? 75 : 150;
  const notInformative = benchmark.maxDrawdown < 0.2 || eligibleSignalDays < minimumEligibleDays;
  let outcome;
  if (notInformative) outcome = "NOT_INFORMATIVE";
  else if (evaluated.allConditionsPass && benchmark.netReturn < 0) outcome = "DEFENSIVE_ONLY_PASS";
  else if (evaluated.allConditionsPass) outcome = "PASS";
  else outcome = "FAIL";
  const l90Pass = outcome === "PASS" || outcome === "DEFENSIVE_ONLY_PASS";
  const stage = lookName === "L90"
    ? l90Pass ? "PROVISIONAL_REQUIRES_L183_CONFIRMATION"
      : outcome === "NOT_INFORMATIVE" ? "CONTINUES_TO_L183"
        : "STUDY_ENDS_AT_L90"
    : outcome === "NOT_INFORMATIVE" ? "L183_FINAL_LOOK_NOT_INFORMATIVE" : "L183_FINAL_CONFIRMATION_OR_DECISION";
  return {
    look: lookName,
    outcome,
    stage,
    provisional: lookName === "L90" && l90Pass,
    confirmationRequired: lookName === "L90" && l90Pass ? "L183" : null,
    decisive: !notInformative,
    conditionsDecisive: !notInformative,
    metrics: evaluated.metrics,
    conditions: evaluated.conditions,
  };
}

function parseCandleFile(buffer, fetchedAtMs) {
  const raw = JSON.parse(buffer.toString("utf8"));
  if (!Array.isArray(raw)) throw new Error("CANDLE_FILE_INVALID");
  const map = new Map();
  for (const row of raw) {
    const candle = normalizeCandle(row);
    if (!candle) throw new Error("CANDLE_FILE_ROW_INVALID");
    if (!isClosedDay(candle.date, fetchedAtMs)) continue;
    if (map.has(candle.date) && map.get(candle.date) !== candle.close) throw new Error("DUPLICATE_CANDLE_CONFLICT");
    map.set(candle.date, candle.close);
  }
  return map;
}

function loadMarketData(directory, now, { minimumFetchAt = null } = {}) {
  const manifestBuffer = fs.readFileSync(path.join(directory, "manifest.json"));
  const manifestEnvelope = JSON.parse(manifestBuffer.toString("utf8"));
  const manifest = verifyEnvelope(manifestEnvelope, "MANIFEST");
  if (!manifest || typeof manifest.fetchedAt !== "string" || !Array.isArray(manifest.files)) throw new Error("MANIFEST_INVALID");
  if (manifest.schemaVersion !== 1) throw new Error("MANIFEST_SCHEMA_UNSUPPORTED");
  const fetchedAtMs = Date.parse(manifest.fetchedAt);
  if (!Number.isFinite(fetchedAtMs) || fetchedAtMs > Number(now)) throw new Error("MANIFEST_FETCH_TIME_INVALID");
  if (minimumFetchAt !== null && fetchedAtMs < Number(minimumFetchAt)) throw new Error("LOOK_REQUIRES_POST_RUN_FETCH");
  if (manifest.files.length !== MARKETS.length) throw new Error("MANIFEST_MARKET_SET_MISMATCH");
  const marketFiles = new Map(manifest.files.map((file) => [file.market, file]));
  if (marketFiles.size !== MARKETS.length || MARKETS.some((market) => !marketFiles.has(market))) throw new Error("MANIFEST_MARKET_SET_MISMATCH");
  const marketCandles = new Map();
  for (const market of MARKETS) {
    const file = marketFiles.get(market);
    if (file.file !== `candles/${market}.json` || typeof file.sha256 !== "string") throw new Error("MANIFEST_FILE_ENTRY_INVALID");
    const buffer = fs.readFileSync(path.join(directory, file.file));
    if (sha256(buffer) !== file.sha256) throw new Error("CANDLE_FILE_HASH_MISMATCH");
    marketCandles.set(market, parseCandleFile(buffer, fetchedAtMs));
  }
  return { manifest, manifestSha256: manifestEnvelope.sha256, marketCandles, fetchedAtMs };
}

async function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requestPage(market, to, fetchImpl = globalThis.fetch) {
  const url = new URL(UPBIT_DAILY_CANDLES);
  url.searchParams.set("market", market);
  url.searchParams.set("to", to);
  url.searchParams.set("count", String(PAGE_SIZE));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
    } catch (error) {
      if (attempt === 2) throw new Error("UPBIT_REQUEST_FAILED");
      await delay(500 * (attempt + 1));
      continue;
    }
    if (response.status === 404) return [];
    if (response.status === 429 || response.status >= 500) {
      if (attempt === 2) throw new Error(`UPBIT_HTTP_${response.status}`);
      await delay(500 * (attempt + 1));
      continue;
    }
    if (!response.ok) throw new Error(`UPBIT_HTTP_${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body)) throw new Error("UPBIT_RESPONSE_INVALID");
    return body;
  }
  throw new Error("UPBIT_REQUEST_FAILED");
}

async function fetchMarketCandles(market, fetchedAt, fetchImpl = globalThis.fetch) {
  const fetchedAtMs = Date.parse(fetchedAt);
  let cursor = fetchedAt;
  const candles = new Map();
  let previousOldest = null;
  while (true) {
    await delay(120);
    const page = await requestPage(market, cursor, fetchImpl);
    if (page.length === 0) break;
    if (page.length > PAGE_SIZE) throw new Error("UPBIT_PAGE_TOO_LARGE");
    const normalized = page.map(normalizeCandle).filter(Boolean);
    if (normalized.length !== page.length) throw new Error("UPBIT_PAGE_INVALID");
    if (page.some((row) => row.market !== undefined && row.market !== market)) throw new Error("UPBIT_MARKET_MISMATCH");
    for (const candle of normalized) {
      if (!isClosedDay(candle.date, fetchedAtMs)) continue;
      if (candles.has(candle.date) && candles.get(candle.date) !== candle.close) throw new Error("UPBIT_DUPLICATE_CANDLE_CONFLICT");
      candles.set(candle.date, candle.close);
    }
    const oldestDate = normalized.reduce((oldest, candle) => candle.date < oldest ? candle.date : oldest, normalized[0].date);
    const historicalCount = [...candles.keys()].reduce((count, date) => count + Number(date <= FIRST_SIGNAL_DAY), 0);
    if (historicalCount >= MIN_HISTORY_CANDLES) break;
    if (oldestDate === previousOldest) throw new Error("UPBIT_PAGINATION_DID_NOT_ADVANCE");
    previousOldest = oldestDate;
    cursor = `${oldestDate}T00:00:00.000Z`;
  }
  return [...candles.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, close]) => ({ date, close }));
}

async function fetchDataset(directory, { fetchImpl = globalThis.fetch } = {}) {
  assertFetchTime();
  if (typeof fetchImpl !== "function") throw new Error("FETCH_UNAVAILABLE");
  const fetchedAt = new Date().toISOString();
  fs.mkdirSync(directory, { recursive: true });
  const manifestPath = path.join(directory, "manifest.json");
  if (fs.existsSync(manifestPath)) throw new Error("FETCH_MANIFEST_ALREADY_EXISTS");
  const candlesDirectory = path.join(directory, "candles");
  fs.mkdirSync(candlesDirectory, { recursive: true });
  const files = [];
  for (const market of MARKETS) {
    const candles = await fetchMarketCandles(market, fetchedAt, fetchImpl);
    const file = `candles/${market}.json`;
    const buffer = Buffer.from(serializeJson(candles));
    fs.writeFileSync(path.join(directory, file), buffer, { flag: "wx" });
    files.push({ market, file, sha256: sha256(buffer) });
  }
  const envelope = hashedEnvelope({
    schemaVersion: 1,
    fetchedAt,
    source: UPBIT_DAILY_CANDLES,
    files,
  });
  fs.writeFileSync(manifestPath, serializeJson(envelope), { flag: "wx" });
  return { manifestPath, manifestSha256: envelope.sha256, fetchedAt };
}

function runLook(directory, lookName) {
  const now = Date.now();
  const look = assertLookTime(lookName);
  const resultDirectory = path.join(directory, "results");
  const resultPath = path.join(resultDirectory, `${lookName}.json`);
  if (fs.existsSync(resultPath)) throw new Error("LOOK_RESULT_ALREADY_EXISTS");
  const loaded = loadMarketData(directory, now, { minimumFetchAt: Date.parse(look.runAt) });
  const days = buildSeries(loaded.marketCandles, lookName);
  const result = evaluateLook(days, lookName);
  const payload = {
    look: lookName,
    outcome: result.outcome,
    ...result,
    schemaVersion: 1,
    study: "RESEARCH_PREREG_BREADTH_FILTER_2026-11-25",
    runAt: look.runAt,
    computedAt: new Date(now).toISOString(),
    manifestSha256: loaded.manifestSha256,
  };
  const envelope = hashedEnvelope(payload);
  fs.mkdirSync(resultDirectory, { recursive: true });
  fs.writeFileSync(resultPath, serializeJson(envelope), { flag: "wx" });
  return { resultPath, envelope };
}

async function main(argv = process.argv.slice(2)) {
  if (argv[0] === "fetch" && argv.length === 2) {
    const result = await fetchDataset(path.resolve(argv[1]));
    process.stdout.write(`BREADTH_FETCH_WRITTEN ${result.manifestPath} sha256=${result.manifestSha256} fetchedAt=${result.fetchedAt}\n`);
    return;
  }
  if (argv[0] === "look" && argv.length === 3) {
    const result = runLook(path.resolve(argv[2]), argv[1]);
    process.stdout.write(serializeJson(result.envelope));
    return;
  }
  throw new Error("USAGE: fetch <dir> | look <L30|L60|L90|L183> <dir>");
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
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
};
