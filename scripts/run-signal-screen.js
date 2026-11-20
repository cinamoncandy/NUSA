"use strict";
/**
 * Pre-registered pooled hourly signal screen RULE_SIGNAL_SCREEN_60M_20261120, work order WO-LEARNING-20261120-SIGNAL-SCREEN-SCRIPT.
 * The rules are written in docs/RESEARCH_PREREG_2026-11-20_SIGNAL_SCREEN_60M.md (merged); this file implements that document and nothing else.
 * It reads research_closed_candles (1 m) and research_candle_absence READ-ONLY from NUSA_CLOUD_STATE_DB_PATH and prints one line:
 *   SIGNAL_SCREEN_STUDY {"status":"WAITING_DATA"|"INSUFFICIENT_DATA"|"DATA_INTEGRITY_FAIL"|"SCREEN_PASS"|"SCREEN_FAIL", ...fixed numeric fields}
 * It places no order, writes nothing; a pass makes a signal eligible for its own pre-registered tradability test only.
 * Before 2027-01-17T00:30Z it reads close times only (counts): no candle value is selected on the WAITING_DATA path.
 * The uniform generator, the Spearman rank correlation and their definitions are shared with scripts/run-crossmarket-study.js (same splitmix64 into
 * xoshiro256**, same average ranks); the test vector of the pre-registration is checked in the tests.
 */
const crypto = require("node:crypto");
const { makeRandom, spearman } = require("./run-crossmarket-study.js");

const M = 60_000;
const H = 60 * M;
const DAY = 24 * H;
const MARKETS = Object.freeze(["KRW-BTC", "KRW-DOGE", "KRW-ETH", "KRW-SOL", "KRW-XRP"]);
const STUDY_ID = "RULE_SIGNAL_SCREEN_60M_20261120";
const ELIG_START = Date.parse("2026-12-11T00:00:00Z");
const SCREEN_START = Date.parse("2026-12-18T00:00:00Z");
const SCREEN_END = Date.parse("2027-01-17T00:00:00Z");
const EARLIEST_RUN = Date.parse("2027-01-17T00:30:00Z");
const SEED = 20261120;
const B = 10_000;
const BLOCK_RESTART = 1 / 24;
const K = 6;
const ALPHA = 0.05;
const MIN_ELIGIBLE = 3;
const MIN_COMPLETE_BARS = 152;
const MIN_USABLE_HOURS = 600;
const LOOKBACK_FROM = ELIG_START - H; // bars of the first eligibility hour need (t - 60 min, t]
const WEEK = 7 * DAY;

// ---- the family (frozen, table order; key = letters only so the diagnosis can project it) ----
const SIGNALS = Object.freeze([
  Object.freeze({ key: "retSix", name: "RET6", s: -1 }),
  Object.freeze({ key: "retDay", name: "RET24", s: 1 }),
  Object.freeze({ key: "retThreeDays", name: "RET72", s: 1 }),
  Object.freeze({ key: "volDay", name: "VOL24", s: -1 }),
  Object.freeze({ key: "surge", name: "SURGE", s: 1 }),
  Object.freeze({ key: "rangeDay", name: "RANGE", s: 1 }),
]);

// ---- data ----
function loadMarket(db, market) {
  const close = new Map(); const volume = new Map();
  for (const r of db.prepare("SELECT close_time_ms AS t, close AS c, volume AS v FROM research_closed_candles WHERE market = ? AND interval_ms = ? AND close_time_ms >= ? AND close_time_ms <= ? ORDER BY close_time_ms ASC").iterate(market, M, LOOKBACK_FROM - 3 * DAY, SCREEN_END)) {
    close.set(Number(r.t), Number(r.c)); volume.set(Number(r.t), r.v === null || r.v === undefined ? null : Number(r.v));
  }
  const absent = new Set();
  for (const r of db.prepare("SELECT first_absent_close_ms AS a, last_absent_close_ms AS b FROM research_candle_absence WHERE market = ? AND interval_ms = ? AND last_absent_close_ms >= ? AND first_absent_close_ms <= ?").iterate(market, M, LOOKBACK_FROM - 3 * DAY, SCREEN_END)) {
    for (let t = Math.max(Number(r.a), LOOKBACK_FROM - 3 * DAY); t <= Math.min(Number(r.b), SCREEN_END); t += M) absent.add(t);
  }
  return { market, close, volume, absent, barCache: new Map() };
}
/** A bar ending at t is complete if all 60 one-minute closes in (t - 60 min, t] are present or proven exchange-absent. */
function barComplete(s, t) {
  const c = s.barCache.get(t); if (c !== undefined) return c;
  let ok = true;
  for (let k = 0; k < 60 && ok; k += 1) { const m = t - k * M; if (!s.close.has(m) && !s.absent.has(m)) ok = false; }
  s.barCache.set(t, ok); return ok;
}
const eligibleAt = (s, t) => barComplete(s, t) && s.close.has(t);

// ---- the six signals: a value or undefined (no forward fill; a missing needed input makes the value missing) ----
function ret(s, t, hours) { const a = s.close.get(t); const b = s.close.get(t - hours * H); return a === undefined || b === undefined ? undefined : a / b - 1; }
function hourlyCloses(s, t) {
  const out = [];
  for (let k = 24; k >= 0; k -= 1) { const c = s.close.get(t - k * H); if (c === undefined) return undefined; out.push(c); }
  return out;
}
function volDay(s, t) {
  const c = hourlyCloses(s, t); if (c === undefined) return undefined;
  const r = []; for (let i = 1; i < c.length; i += 1) r.push(Math.log(c[i] / c[i - 1]));
  const mean = r.reduce((a, v) => a + v, 0) / r.length;
  return Math.sqrt(r.reduce((a, v) => a + (v - mean) ** 2, 0) / (r.length - 1));
}
function rangeDay(s, t) {
  const c = hourlyCloses(s, t); if (c === undefined) return undefined;
  const lo = Math.min(...c); const hi = Math.max(...c);
  return hi === lo ? undefined : (c[c.length - 1] - lo) / (hi - lo);
}
function surge(s, t) {
  let last = 0; let day = 0;
  for (let k = 0; k < 1440; k += 1) {
    const m = t - k * M; let v;
    if (s.volume.has(m)) { v = s.volume.get(m); if (v === null) return undefined; } else if (s.absent.has(m)) v = 0; else return undefined;
    day += v; if (k < 60) last += v;
  }
  return day === 0 ? undefined : last / (day / 24);
}
const SIGNAL_FN = Object.freeze({
  retSix: (s, t) => ret(s, t, 6), retDay: (s, t) => ret(s, t, 24), retThreeDays: (s, t) => ret(s, t, 72),
  volDay, surge, rangeDay,
});

// ---- statistics ----
/** Stationary bootstrap of the weighted mean (null imposed by centring), exactly the pseudocode of the pre-registration. */
function bootstrapP(xs, ws, random, resamples = B) {
  const T = xs.length;
  let sw = 0; let swx = 0; for (let j = 0; j < T; j += 1) { sw += ws[j]; swx += ws[j] * xs[j]; }
  const Mean = swx / sw;
  const xc = xs.map((x) => x - Mean);
  let ge = 0;
  for (let b = 0; b < resamples; b += 1) {
    let sumWX = 0; let sumW = 0; let j = 0;
    for (let pos = 0; pos < T; pos += 1) {
      if (pos === 0) j = Math.floor(random() * T);
      else if (random() < BLOCK_RESTART) j = Math.floor(random() * T);
      else j = (j + 1) % T;
      sumWX += ws[j] * xc[j]; sumW += ws[j];
    }
    if (sumWX / sumW >= Mean) ge += 1;
  }
  return (1 + ge) / (resamples + 1);
}
/** Holm step-down over K p-values given in table order; ties ordered by table order. */
function holm(ps) {
  const order = ps.map((p, i) => [p, i]).sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const adj = new Array(ps.length); let running = 0;
  order.forEach(([p, i], idx) => { running = Math.max(running, (ps.length - idx) * p); adj[i] = Math.min(1, running); });
  return adj;
}
const weightedMean = (xs, ws) => { let a = 0; let b = 0; for (let i = 0; i < xs.length; i += 1) { a += ws[i] * xs[i]; b += ws[i]; } return b === 0 ? 0 : a / b; };

/** Hourly IC series of one signal over the screening span, with the counts the pre-registration asks for. */
function icSeries(eligible, signal, from, to, targetHours = 1) {
  const fn = SIGNAL_FN[signal.key];
  const hours = []; let skippedHours = 0; let constantHours = 0; let excluded4h = 0;
  for (let t = from; t + H <= to; t += H) {
    if (targetHours !== 1 && t + targetHours * H > to) { excluded4h += 1; continue; }
    const xs = []; const ys = [];
    for (const s of eligible) {
      if (!eligibleAt(s, t)) continue;
      const y1 = s.close.get(t + targetHours * H); if (y1 === undefined) continue;
      const v = fn(s, t); if (v === undefined) continue;
      xs.push(v); ys.push(y1 / s.close.get(t) - 1);
    }
    if (xs.length < MIN_ELIGIBLE) { skippedHours += 1; continue; }
    const ic = spearman(xs, ys);
    if (ic === undefined) { constantHours += 1; continue; }
    hours.push({ t, ic, n: xs.length });
  }
  return { hours, skippedHours, constantHours, excluded4h };
}

function round(x, d) { const f = 10 ** d; return Math.round(x * f) / f; }
const p3 = (x) => Number(x.toPrecision(3));

function coverageCounts(db, now) {
  const to = Math.min(now, SCREEN_END); const out = {};
  for (const market of MARKETS) {
    let n = 0; for (const _ of db.prepare("SELECT close_time_ms FROM research_closed_candles WHERE market = ? AND interval_ms = ? AND close_time_ms > ? AND close_time_ms <= ?").iterate(market, M, ELIG_START - H, to)) n += 1;
    out[`${market.slice(4).toLowerCase()}Minutes`] = n;
  }
  return out;
}

function runScreen({ db, now = Date.now(), resamples = B }) {
  if (now < EARLIEST_RUN) return { status: "WAITING_DATA", daysCollected: Math.max(0, Math.floor((Math.min(now, SCREEN_END) - ELIG_START) / DAY)), ...coverageCounts(db, now) };
  const future = Number(db.prepare("SELECT COUNT(*) AS n FROM research_closed_candles WHERE close_time_ms > ?").get(now + 5_000).n);
  if (future > 0) return { status: "DATA_INTEGRITY_FAIL", reasonCode: "DATA_FUTURE" };
  const all = MARKETS.map((m) => loadMarket(db, m));
  const eligible = all.filter((s) => {
    let complete = 0; for (let t = ELIG_START; t + H <= SCREEN_START; t += H) if (barComplete(s, t)) complete += 1;
    return complete >= MIN_COMPLETE_BARS;
  });
  if (eligible.length < MIN_ELIGIBLE) return { status: "INSUFFICIENT_DATA", markets: MARKETS.length, eligible: eligible.length };

  const results = SIGNALS.map((signal) => {
    const base = icSeries(eligible, signal, SCREEN_START, SCREEN_END, 1);
    const hours = base.hours; const usable = hours.length;
    const insufficient = usable < MIN_USABLE_HOURS;
    const xs = hours.map((h) => signal.s * h.ic); const ws = hours.map((h) => h.n - 1);
    const mean = usable === 0 ? 0 : weightedMean(xs, ws);
    const p = insufficient ? 1 : bootstrapP(xs, ws, makeRandom(SEED), resamples);
    const four = icSeries(eligible, signal, SCREEN_START, SCREEN_END, 4);
    const fourMean = four.hours.length === 0 ? 0 : weightedMean(four.hours.map((h) => signal.s * h.ic), four.hours.map((h) => h.n - 1));
    const weeks = [0, 1, 2, 3, 4].map((w) => { const idx = hours.map((h, i) => [h, i]).filter(([h]) => Math.floor((h.t - SCREEN_START) / WEEK) === w).map(([, i]) => i); return idx.length === 0 ? 0 : round(weightedMean(idx.map((i) => xs[i]), idx.map((i) => ws[i])), 5); });
    return { signal, usable, insufficient, mean, p, skipped: base.skippedHours, constant: base.constantHours, fourMean, fourHours: four.hours.length, fourExcluded: four.excluded4h, weeks };
  });
  const adj = holm(results.map((r) => r.p));
  results.forEach((r, i) => { r.adjP = adj[i]; r.pass = !r.insufficient && r.mean > 0 && r.adjP < ALPHA; });

  const hash = crypto.createHash("sha256"); let rows = 0;
  for (const s of eligible) {
    hash.update(`${s.market}\n`);
    for (const [t, c] of s.close) { hash.update(`c,${t},${c},${s.volume.get(t)}\n`); rows += 1; }
    for (const t of [...s.absent].sort((a, b) => a - b)) hash.update(`a,${t}\n`);
  }
  const out = {
    status: results.some((r) => r.pass) ? "SCREEN_PASS" : "SCREEN_FAIL", markets: MARKETS.length, eligible: eligible.length, k: K,
    datasetFingerprint: hash.digest("hex"), datasetRows: rows,
  };
  for (const r of results) {
    const k = r.signal.key;
    out[`${k}Hours`] = r.usable; out[`${k}SkippedHours`] = r.skipped; out[`${k}ConstantHours`] = r.constant;
    out[`${k}MeanIc`] = round(r.mean, 5); out[`${k}P`] = p3(r.p); out[`${k}AdjP`] = p3(r.adjP); out[`${k}Pass`] = r.pass; out[`${k}Insufficient`] = r.insufficient;
    out[`${k}FourHourMeanIc`] = round(r.fourMean, 5); out[`${k}FourHourHours`] = r.fourHours; out[`${k}FourHourExcluded`] = r.fourExcluded;
    r.weeks.forEach((w, i) => { out[`${k}WeekIc${["Zero", "One", "Two", "Three", "Four"][i]}`] = w; });
  }
  return out;
}

module.exports = {
  runScreen, icSeries, bootstrapP, holm, weightedMean, loadMarket, barComplete, eligibleAt, SIGNALS, SIGNAL_FN, MARKETS, STUDY_ID,
  ELIG_START, SCREEN_START, SCREEN_END, EARLIEST_RUN, SEED, B, K, MIN_USABLE_HOURS, MIN_COMPLETE_BARS,
};

if (require.main === module) {
  try {
    const { DatabaseSync } = require("node:sqlite");
    const path = String(process.env.NUSA_CLOUD_STATE_DB_PATH || "");
    if (!path.startsWith("/")) throw new Error("state path");
    const db = new DatabaseSync(path, { readOnly: true });
    try { console.log("SIGNAL_SCREEN_STUDY", JSON.stringify({ ...runScreen({ db }), studyId: STUDY_ID })); } finally { db.close(); }
  } catch { console.error("SIGNAL_SCREEN_STUDY_FAILED_CLOSED"); process.exitCode = 1; }
}
