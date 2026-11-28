#!/usr/bin/env node
"use strict";

// Deterministic, offline historical screen. It accepts a frozen grammar and
// pre-read Upbit daily OHLCV files; it has no network or trading boundary.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DAY = 86_400_000;
const CUTOFF_EXCLUSIVE = Date.parse("2026-11-05T00:00:00.000Z");
const BASE_FEE = 0.0015;
const STRESS_FEE = 0.003;
const DEFAULT_MIN_HISTORY_DAYS = 90;
const MAX_INPUT_BYTES = 128 * 1024 * 1024;
const MARKET_RE = /^KRW-[A-Z0-9]{2,12}$/;
const ID_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const KINDS = new Set([
  "SIZE_REV",
  "LISTING_AGE",
  "WEEKDAY_XS",
  "BTC_BETA_ROT",
  "VOL_COMPRESS_BREAK",
  "DOWNVOL_LOW",
]);

function fail(code) { throw new Error(code); }
function isRecord(x) { return x !== null && typeof x === "object" && !Array.isArray(x); }
function sortJson(x) {
  if (Array.isArray(x)) return x.map(sortJson);
  if (isRecord(x)) return Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortJson(x[k])]));
  return x;
}
function canonicalJson(x) { return JSON.stringify(sortJson(x)); }
function sha256(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function readCanonicalJson(file, code) {
  const bytes = fs.readFileSync(file);
  if (bytes.length > MAX_INPUT_BYTES) fail(`${code}_TOO_LARGE`);
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { fail(`${code}_UTF8_INVALID`); }
  if (text.includes("\r")) fail(`${code}_NEWLINES_INVALID`);
  let value;
  try { value = JSON.parse(text); }
  catch { fail(`${code}_JSON_INVALID`); }
  if (text !== `${canonicalJson(value)}\n`) fail(`${code}_NOT_CANONICAL`);
  return { bytes, value };
}

function integer(value, min, max, code) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(code);
  return value;
}
function validateGrammar(grammar) {
  if (!isRecord(grammar) || grammar.schemaVersion !== 1) fail("GRAMMAR_SCHEMA_INVALID");
  const keys = ["schemaVersion", "declaredAtUtc", "k", "minHistoryDays", "universe", "families"].sort();
  if (canonicalJson(Object.keys(grammar).sort()) !== canonicalJson(keys)) fail("GRAMMAR_KEYS_INVALID");
  if (typeof grammar.declaredAtUtc !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(grammar.declaredAtUtc) ||
      new Date(grammar.declaredAtUtc).toISOString() !== grammar.declaredAtUtc) fail("GRAMMAR_DECLARED_AT_INVALID");
  integer(grammar.k, 1, 100_000, "GRAMMAR_K_INVALID");
  integer(grammar.minHistoryDays, 90, 3650, "GRAMMAR_MIN_HISTORY_INVALID");
  if (!Array.isArray(grammar.universe) || grammar.universe.length < 1 || grammar.universe.length > 1000) fail("GRAMMAR_UNIVERSE_INVALID");
  if (grammar.universe.some((m) => typeof m !== "string" || !MARKET_RE.test(m))) fail("GRAMMAR_MARKET_INVALID");
  if (grammar.universe.some((m, i) => i > 0 && grammar.universe[i - 1] >= m)) fail("GRAMMAR_UNIVERSE_NOT_SORTED");
  if (!Array.isArray(grammar.families) || grammar.families.length < 1 || grammar.families.length > grammar.k) fail("GRAMMAR_FAMILIES_INVALID");
  const ids = new Set();
  for (const family of grammar.families) {
    if (!isRecord(family) || canonicalJson(Object.keys(family).sort()) !== canonicalJson(["id", "kind", "holdDays", "parameters"].sort())) fail("FAMILY_KEYS_INVALID");
    if (typeof family.id !== "string" || !ID_RE.test(family.id) || ids.has(family.id)) fail("FAMILY_ID_INVALID");
    if (typeof family.kind !== "string" || !KINDS.has(family.kind)) fail("FAMILY_KIND_INVALID");
    integer(family.holdDays, 1, 90, "FAMILY_HOLD_INVALID");
    if (!isRecord(family.parameters)) fail("FAMILY_PARAMETERS_INVALID");
    validateParameters(family);
    ids.add(family.id);
  }
  return grammar;
}
function validateParameters(family) {
  const p = family.parameters;
  const exact = (names) => {
    if (canonicalJson(Object.keys(p).sort()) !== canonicalJson([...names].sort())) fail("FAMILY_PARAMETER_KEYS_INVALID");
  };
  switch (family.kind) {
    case "SIZE_REV":
      exact(["turnoverLookbackDays", "pickFraction", "returnLookbackDays"]);
      integer(p.turnoverLookbackDays, 2, 365, "FAMILY_PARAMETER_INVALID");
      integer(p.returnLookbackDays, 1, 365, "FAMILY_PARAMETER_INVALID");
      if (typeof p.pickFraction !== "number" || !Number.isFinite(p.pickFraction) || p.pickFraction <= 0 || p.pickFraction > 1) fail("FAMILY_PARAMETER_INVALID");
      break;
    case "LISTING_AGE":
      exact(["minAgeDays", "maxAgeDays", "returnLookbackDays"]);
      integer(p.minAgeDays, 90, 3650, "FAMILY_PARAMETER_INVALID");
      integer(p.maxAgeDays, p.minAgeDays, 3650, "FAMILY_PARAMETER_INVALID");
      integer(p.returnLookbackDays, 2, 365, "FAMILY_PARAMETER_INVALID");
      break;
    case "WEEKDAY_XS":
      exact(["utcWeekday", "returnLookbackDays"]);
      integer(p.utcWeekday, 0, 6, "FAMILY_PARAMETER_INVALID");
      integer(p.returnLookbackDays, 1, 30, "FAMILY_PARAMETER_INVALID");
      break;
    case "BTC_BETA_ROT":
      exact(["betaLookbackDays", "btcTrendLookbackDays"]);
      integer(p.betaLookbackDays, 20, 365, "FAMILY_PARAMETER_INVALID");
      integer(p.btcTrendLookbackDays, 1, 365, "FAMILY_PARAMETER_INVALID");
      if (!family.parameters || !family.parameters.betaLookbackDays) fail("FAMILY_PARAMETER_INVALID");
      break;
    case "VOL_COMPRESS_BREAK":
      exact(["rangeDays", "historyDays", "quantile", "breakoutDays", "volumeLookbackDays"]);
      integer(p.rangeDays, 2, 30, "FAMILY_PARAMETER_INVALID");
      integer(p.historyDays, p.rangeDays, 365, "FAMILY_PARAMETER_INVALID");
      if (typeof p.quantile !== "number" || !Number.isFinite(p.quantile) || p.quantile <= 0 || p.quantile >= 1) fail("FAMILY_PARAMETER_INVALID");
      integer(p.breakoutDays, 1, 90, "FAMILY_PARAMETER_INVALID");
      integer(p.volumeLookbackDays, 2, 180, "FAMILY_PARAMETER_INVALID");
      break;
    case "DOWNVOL_LOW":
      exact(["lookbackDays", "minimumDownDays"]);
      integer(p.lookbackDays, 2, 365, "FAMILY_PARAMETER_INVALID");
      integer(p.minimumDownDays, 2, p.lookbackDays, "FAMILY_PARAMETER_INVALID");
      break;
    default: fail("FAMILY_KIND_INVALID");
  }
}

// Input rows are the existing [tsMs, open, high, low, close, volume] shape.
// Parse the timestamp before parsing the rest of each row; any post-cutoff row
// aborts the whole screen rather than being silently dropped or analyzed.
function parseRowsBeforeCutoff(text) {
  let i = 0;
  const ws = () => { while (/\s/.test(text[i] || "")) i++; };
  const rowEnd = (start) => {
    let depth = 0, quoted = false, escape = false;
    for (let j = start; j < text.length; j++) {
      const c = text[j];
      if (quoted) {
        if (escape) escape = false;
        else if (c === "\\") escape = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === "[") depth++;
      else if (c === "]" && --depth === 0) return j + 1;
    }
    fail("DATA_ROW_TRUNCATED");
  };
  ws();
  if (text[i++] !== "[") fail("DATA_ARRAY_INVALID");
  const rows = [];
  ws();
  if (text[i] === "]") { i++; ws(); if (i !== text.length) fail("DATA_TRAILING_BYTES"); return rows; }
  while (i < text.length) {
    ws();
    if (text[i] !== "[") fail("DATA_ROW_INVALID");
    const start = i;
    i++;
    ws();
    const tsStart = i;
    while (/[0-9-]/.test(text[i] || "")) i++;
    if (tsStart === i || !/^\d+$/.test(text.slice(tsStart, i))) fail("DATA_TIMESTAMP_INVALID");
    const ts = Number(text.slice(tsStart, i));
    if (!Number.isSafeInteger(ts) || ts < 0) fail("DATA_TIMESTAMP_INVALID");
    if (ts >= CUTOFF_EXCLUSIVE) fail("DATA_DATE_AFTER_CUTOFF");
    ws();
    if (text[i++] !== ",") fail("DATA_ROW_INVALID");
    const end = rowEnd(start);
    let row;
    try { row = JSON.parse(text.slice(start, end)); }
    catch { fail("DATA_ROW_JSON_INVALID"); }
    if (!Array.isArray(row) || row.length !== 6 || row[0] !== ts || row.some((v) => typeof v !== "number" || !Number.isFinite(v))) fail("DATA_ROW_SHAPE_INVALID");
    if (ts % DAY !== 0 || row[1] <= 0 || row[2] <= 0 || row[3] <= 0 || row[4] <= 0 || row[5] < 0 || row[2] < row[3]) fail("DATA_ROW_VALUE_INVALID");
    if (rows.length && ts <= rows[rows.length - 1][0]) fail("DATA_ROWS_NOT_STRICTLY_SORTED");
    rows.push(row);
    i = end;
    ws();
    if (text[i] === ",") { i++; continue; }
    if (text[i] === "]") { i++; ws(); if (i !== text.length) fail("DATA_TRAILING_BYTES"); return rows; }
    fail("DATA_ARRAY_INVALID");
  }
  fail("DATA_ARRAY_TRUNCATED");
}
function loadDailyDirectory(inputDir, expectedUniverse) {
  const files = fs.readdirSync(inputDir).filter((name) => name.endsWith(".json")).sort();
  const markets = files.map((name) => name.slice(0, -5));
  if (canonicalJson(markets) !== canonicalJson(expectedUniverse)) fail("DATA_UNIVERSE_MISMATCH");
  const byMarket = new Map(), firstDate = new Map(), hashes = [];
  const allDates = new Set();
  for (let n = 0; n < files.length; n++) {
    const filePath = path.join(inputDir, files[n]);
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.size > MAX_INPUT_BYTES) fail("DATA_FILE_NOT_REGULAR_OR_TOO_LARGE");
    const bytes = fs.readFileSync(filePath);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const rows = parseRowsBeforeCutoff(text);
    if (!rows.length) fail("DATA_MARKET_EMPTY");
    const market = markets[n];
    if (!MARKET_RE.test(market)) fail("DATA_MARKET_INVALID");
    const map = new Map(rows.map((r) => [r[0], r]));
    byMarket.set(market, map);
    firstDate.set(market, rows[0][0]);
    for (const row of rows) allDates.add(row[0]);
    hashes.push({ market, rows: rows.length, sourceSha256: sha256(bytes) });
  }
  return { byMarket, firstDate, dates: [...allDates].sort((a, b) => a - b), hashes };
}

const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const sampleStd = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
function normalSf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z >= 0 ? p : 1 - p;
}
function segment(series, t, lookback) {
  const result = [];
  for (let k = lookback; k >= 0; k--) {
    const row = series.get(t - k * DAY);
    if (!row) return null;
    result.push(row);
  }
  return result;
}
const simpleReturns = (closes) => closes.slice(1).map((x, i) => x / closes[i] - 1);
const logReturns = (closes) => closes.slice(1).map((x, i) => Math.log(x / closes[i]));
function scoreFamily(family, t, eligible, data) {
  const p = family.parameters, candidates = [];
  const add = (market, score) => { if (Number.isFinite(score)) candidates.push({ market, score }); };
  for (const market of eligible) {
    const series = data.byMarket.get(market);
    switch (family.kind) {
      case "SIZE_REV": {
        const s = segment(series, t, p.turnoverLookbackDays);
        if (!s) break;
        const turnover = mean(s.slice(1).map((r) => r[5] * r[4]));
        const prior = series.get(t - p.returnLookbackDays * DAY);
        const current = series.get(t);
        if (!prior || !current) break;
        // Select the low-turnover slice first; score after this candidate pass.
        add(market, -turnover - 0); // stable finite sentinel; replaced below.
        candidates[candidates.length - 1] = { market, score: -turnover, returnScore: -(current[4] / prior[4] - 1) };
        break;
      }
      case "LISTING_AGE": {
        const age = (t - data.firstDate.get(market)) / DAY;
        if (age < p.minAgeDays || age > p.maxAgeDays) break;
        const s = segment(series, t, p.returnLookbackDays);
        if (!s) break;
        const closes = s.map((r) => r[4]);
        const vol = sampleStd(logReturns(closes));
        // Preserve the reference screen's IEEE sort behavior for zero-volatility
        // candidates (its result note discloses the possible non-finite score).
        candidates.push({ market, score: (closes.at(-1) / closes[0] - 1) / vol });
        break;
      }
      case "WEEKDAY_XS": {
        if (new Date(t).getUTCDay() !== p.utcWeekday) break;
        const current = series.get(t), prior = series.get(t - p.returnLookbackDays * DAY);
        if (current && prior) add(market, current[4] / prior[4] - 1);
        break;
      }
      case "BTC_BETA_ROT": {
        const btc = data.byMarket.get("KRW-BTC");
        const btcSegment = btc && segment(btc, t, p.betaLookbackDays);
        if (!btcSegment) break;
        const btcTrendBase = btc.get(t - p.btcTrendLookbackDays * DAY), btcNow = btc.get(t);
        if (!btcTrendBase || !(btcNow[4] / btcTrendBase[4] - 1 > 0) || market === "KRW-BTC") break;
        const marketSegment = segment(series, t, p.betaLookbackDays);
        if (!marketSegment) break;
        const br = simpleReturns(btcSegment.map((r) => r[4]));
        const mr = simpleReturns(marketSegment.map((r) => r[4]));
        const bm = mean(br), mm = mean(mr);
        const variance = br.reduce((sum, x) => sum + (x - bm) ** 2, 0);
        if (!variance) break;
        const covariance = br.reduce((sum, x, i) => sum + (x - bm) * (mr[i] - mm), 0);
        add(market, covariance / variance);
        break;
      }
      case "VOL_COMPRESS_BREAK": {
        const s = segment(series, t, p.historyDays + p.rangeDays - 2);
        if (!s) break;
        const ranges = [];
        for (let d = p.historyDays - 1; d >= 0; d--) {
          const end = p.historyDays + p.rangeDays - 2 - d;
          let hi = -Infinity, lo = Infinity;
          for (let i = end - p.rangeDays + 1; i <= end; i++) { hi = Math.max(hi, s[i][2]); lo = Math.min(lo, s[i][3]); }
          ranges.push((hi - lo) / s[end][4]);
        }
        const sorted = [...ranges].sort((a, b) => a - b);
        const threshold = sorted[Math.floor(p.quantile * (sorted.length - 1))];
        const currentRange = ranges.at(-1);
        const current = s.at(-1);
        const breakoutStart = s.length - 1 - p.breakoutDays;
        let priorHigh = -Infinity;
        for (let i = breakoutStart; i < s.length - 1; i++) priorHigh = Math.max(priorHigh, s[i][2]);
        const volStart = s.length - 1 - p.volumeLookbackDays;
        const baseVolume = mean(s.slice(volStart, -1).map((r) => r[5]));
        if (currentRange <= threshold && current[4] > priorHigh && baseVolume > 0) add(market, current[5] / baseVolume);
        break;
      }
      case "DOWNVOL_LOW": {
        const s = segment(series, t, p.lookbackDays);
        if (!s) break;
        const down = simpleReturns(s.map((r) => r[4])).filter((r) => r < 0);
        if (down.length >= p.minimumDownDays) add(market, -sampleStd(down));
        break;
      }
      default: fail("FAMILY_KIND_INVALID");
    }
  }
  if (family.kind === "SIZE_REV") {
    candidates.sort((a, b) => b.score - a.score || (a.market < b.market ? -1 : 1));
    const lowTurnover = candidates.slice(0, Math.floor(candidates.length * p.pickFraction));
    lowTurnover.sort((a, b) => b.returnScore - a.returnScore || (a.market < b.market ? -1 : 1));
    return lowTurnover.slice(0, 5).map((x) => ({ market: x.market, score: x.returnScore }));
  }
  return candidates.sort((a, b) => b.score - a.score || (a.market < b.market ? -1 : 1)).slice(0, 5);
}

function dailyReturn(data, market, entry, exit, fee) {
  const series = data.byMarket.get(market), a = series.get(entry), b = series.get(exit);
  if (!a || !b) return null;
  return b[4] * (1 - fee) / (a[4] * (1 + fee)) - 1;
}
function runFamily(family, grammar, data) {
  const dates = data.dates;
  const last = dates.at(-1);
  const cut = last - 365 * DAY;
  const cohorts = [];
  for (const t of dates) {
    const weekday = family.kind === "WEEKDAY_XS";
    if (weekday) {
      if (new Date(t).getUTCDay() !== family.parameters.utcWeekday) continue;
    } else if ((t / DAY) % family.holdDays !== 0) continue;
    const exit = t + family.holdDays * DAY;
    if (exit > last) continue;
    const eligible = grammar.universe.filter((m) => data.byMarket.get(m).has(t) && t - data.firstDate.get(m) >= grammar.minHistoryDays * DAY);
    if (eligible.length < 20) continue;
    const picks = scoreFamily(family, t, eligible, data);
    if (!picks.length) continue;
    const picked = picks.map((x) => x.market);
    const average = (markets, fee) => {
      const returns = markets.map((m) => dailyReturn(data, m, t, exit, fee)).filter((x) => x !== null);
      return returns.length ? mean(returns) : null;
    };
    const pickNet = average(picked, BASE_FEE), universeNet = average(eligible, BASE_FEE);
    const pickStress = average(picked, STRESS_FEE), universeStress = average(eligible, STRESS_FEE);
    if (pickNet === null || universeNet === null || pickStress === null || universeStress === null) continue;
    cohorts.push({ date: t, excess: pickNet - universeNet, stressExcess: pickStress - universeStress, benchmark: universeNet });
  }
  const discovery = cohorts.filter((c) => c.date < cut);
  const confirm = cohorts.filter((c) => c.date >= cut);
  const size = Math.floor(discovery.length / 6);
  const windows = [];
  for (let i = 0; i < 6; i++) {
    const part = discovery.slice(i * size, (i + 1) * size);
    windows.push({
      count: part.length,
      meanExcess: mean(part.map((c) => c.excess)),
      meanStressExcess: mean(part.map((c) => c.stressExcess)),
      benchmarkUp: mean(part.map((c) => c.benchmark)) > 0,
    });
  }
  const up = windows.filter((x) => x.benchmarkUp), down = windows.filter((x) => !x.benchmarkUp);
  const discoveryPass = size >= 10 && windows.filter((x) => x.meanExcess > 0).length >= 4 &&
    up.length > 0 && down.length > 0 && mean(up.map((x) => x.meanExcess)) > 0 &&
    mean(down.map((x) => x.meanExcess)) > 0 && windows.filter((x) => x.meanStressExcess > 0).length >= 4;
  const excess = confirm.map((c) => c.excess), m = mean(excess), sd = sampleStd(excess);
  const p = sd > 0 ? normalSf(m / (sd / Math.sqrt(excess.length))) : 1;
  const stressMean = mean(confirm.map((c) => c.stressExcess));
  const secondPass = confirm.length >= 30 && m > 0 && p < 0.05 / grammar.k && stressMean > 0;
  return {
    id: family.id,
    kind: family.kind,
    cohorts: cohorts.length,
    discoveryCohorts: discovery.length,
    confirmationCohorts: confirm.length,
    discoveryWindows: windows.map((w) => ({ count: w.count, meanExcess: w.meanExcess, meanStressExcess: w.meanStressExcess, benchmarkUp: w.benchmarkUp })),
    meanConfirmationExcess: m,
    oneSidedNormalP: p,
    bonferroniAlpha: 0.05 / grammar.k,
    meanConfirmationStressExcess: stressMean,
    discoveryPass,
    secondFilterPass: secondPass,
    eligibleForForwardRegistration: discoveryPass && secondPass,
  };
}

function screen({ grammar, grammarBytes, inputDir }) {
  validateGrammar(grammar);
  if (!Buffer.isBuffer(grammarBytes) || !grammarBytes.equals(Buffer.from(`${canonicalJson(grammar)}\n`, "utf8"))) fail("GRAMMAR_BYTES_MISMATCH");
  const data = loadDailyDirectory(inputDir, grammar.universe);
  if (!data.dates.length) fail("DATA_NO_DATES");
  const families = grammar.families.map((family) => runFamily(family, grammar, data));
  const output = {
    schemaVersion: 1,
    grammarSha256: sha256(grammarBytes),
    sourceFiles: data.hashes,
    dataStartDateUtc: new Date(data.dates[0]).toISOString().slice(0, 10),
    dataEndDateUtc: new Date(data.dates.at(-1)).toISOString().slice(0, 10),
    cutoffDateUtc: "2026-11-04",
    declaredK: grammar.k,
    rulesTested: families.length,
    eligibleCount: families.filter((x) => x.eligibleForForwardRegistration).length,
    disclosures: {
      historyWasAlreadyRead: true,
      currentMarketUniverseSurvivorshipBias: true,
      fillAtSignalCloseIsOptimistic: true,
      costModel: "15 bp per side; stress 30 bp per side",
      confirmationPValue: "one-sided normal approximation; Bonferroni threshold 0.05/K",
      historyCutoff: "No daily row on or after 2026-11-05 is accepted; order-book data is not read.",
    },
    families,
  };
  return { ...output, outputSha256: sha256(Buffer.from(`${canonicalJson(output)}\n`, "utf8")) };
}

function main(argv) {
  if (argv.length !== 2) {
    process.stderr.write("Usage: node scripts/alpha-lab/screen.js <canonical-grammar.json> <daily-json-directory>\n");
    return 2;
  }
  try {
    const { value: grammar, bytes: grammarBytes } = readCanonicalJson(argv[0], "GRAMMAR");
    const output = screen({ grammar, grammarBytes, inputDir: argv[1] });
    process.stdout.write(`${canonicalJson(output)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
}
if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { CUTOFF_EXCLUSIVE, canonicalJson, parseRowsBeforeCutoff, screen, validateGrammar };
