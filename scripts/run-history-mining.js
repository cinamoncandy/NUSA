"use strict";
/**
 * History mining for candidate generation (docs/RESEARCH_HISTORY_MINING_DESIGN_2026-11-20.md section 4; work order WO-LEARNING-20261120-HISTORY-MINING-SCRIPT).
 * PAPER research only: it reads research_closed_candles (1 m) READ-ONLY, places no order and writes nothing.
 *
 *   node scripts/run-history-mining.js discover --db <state.sqlite> --discovery-start <ISO> --discovery-end <ISO> --holdback-start <ISO> --holdback-end <ISO>
 *   node scripts/run-history-mining.js look     --db <state.sqlite> --freeze <freeze.json>
 *
 * Phases (design section 4): `discover` explores the fixed rule grid in the discovery window only and prints the shortlist (at most 5), the
 * frozen thresholds and the freeze record; the freeze record is committed BEFORE `look`. `look` is the ONE look at the hold-back window: the frozen
 * rules and thresholds are applied unchanged and tested with the circular block bootstrap of the cross-market pre-registration (block 24, B = 10,000,
 * centred null, one-sided, over hourly bins of the hold-back so that simultaneous trades of the markets stay together), Bonferroni over the shortlist size only. The result is descriptive: a filter into forward confirmation, not evidence.
 *
 * Blindness: candle values at or after CUT (2026-11-20T00:00Z) are reserved by the pre-registrations and are never selected (the SQL bound is the
 * minimum of the requested end and CUT, and every window is checked against CUT before anything is read). The hold-back must lie at least PURGE
 * (96 h) after the discovery window. Rules that duplicate a pre-registered signal by formula (RET6, RET24, RET72, VOL24, SURGE, RANGE) are not in the grid.
 * XRP is not blind (earlier experiments): it is discovery-only and never enters the hold-back.
 * Output: aggregates only (counts, means, p-values, rule ids, thresholds). No candle value is printed.
 */
const crypto = require("node:crypto");
const { makeRandom } = require("./run-crossmarket-study.js");

const M = 60_000;
const H = 60 * M;
const CUT = Date.parse("2026-11-20T00:00:00Z");
const PURGE = 96 * H; // the 72 h lookback plus the longest hold (24 h): no signal or trade return of one window shares a price interval with the other
const BLIND_MARKETS = Object.freeze(["KRW-BTC", "KRW-ETH", "KRW-NEAR", "KRW-SOL"]);
const DISCOVERY_ONLY_MARKETS = Object.freeze(["KRW-XRP"]);
const FEE = 0.0005; // per side
const COST = 2 * FEE; // round trip, base
const STRESS_COST = 2 * (2 * FEE + 0.0005); // per side 2 x fee + 5 bp (pre-registration section 2), so about 30 bp for the round trip
const MIN_TRADES = 100; // discovery shortlist
const MIN_LOOK_TRADES = 50; // the look: fewer trades than this is not testable (never a pass)
const MAX_SHORTLIST = 5;
const MAX_OVERLAP = 0.5;
const ALPHA_TOTAL = 0.05;
const BLOCK = 24;
const B = 10_000;
const SEED = 20261121;
const LOOKBACK_HOURS = 72;

// ---- the fixed grid (code is the freezing record: its hash is printed) ----
const SIGNALS = Object.freeze([
  Object.freeze({ id: "RET1", f: (h) => ratio(h, 0, 1) }),
  Object.freeze({ id: "RET3", f: (h) => ratio(h, 0, 3) }),
  Object.freeze({ id: "RET12", f: (h) => ratio(h, 0, 12) }),
  Object.freeze({ id: "RET48", f: (h) => ratio(h, 0, 48) }),
  Object.freeze({ id: "VOLRATIO", f: (h) => volRatio(h) }),
  Object.freeze({ id: "CLOSE_VS_MA24", f: (h) => closeVsMean(h, 24) }),
  Object.freeze({ id: "DRAWDOWN24", f: (h) => extreme(h, 24, Math.max) }),
  Object.freeze({ id: "RUNUP24", f: (h) => extreme(h, 24, Math.min) }),
]);
const SIDES = Object.freeze(["HIGH", "LOW"]); // enter when the signal is at or above its q-quantile (HIGH) or at or below its (1 - q)-quantile (LOW)
const QUANTILES = Object.freeze([0.8, 0.9]);
const HOLDS = Object.freeze([1, 4, 12, 24]);

const RULES = Object.freeze(SIGNALS.flatMap((s) => SIDES.flatMap((side) => QUANTILES.flatMap((q) => HOLDS.map((hold) => Object.freeze({ id: `${s.id}_${side}_Q${Math.round(q * 100)}_H${hold}`, signal: s.id, side, q, hold }))))));
// The grid fingerprint binds the grid parameters and constants (ids, sides, quantiles, holds, costs, minimums, block, B, seed, purge, cut), NOT the signal
// formulas or the other function bodies: the freeze record therefore also carries the source commit sha of the code that produced it.
const GRID_FINGERPRINT = crypto.createHash("sha256").update(JSON.stringify({ SIGNALS: SIGNALS.map((s) => s.id), SIDES, QUANTILES, HOLDS, FEE, COST, STRESS_COST, MIN_TRADES, MAX_SHORTLIST, MAX_OVERLAP, ALPHA_TOTAL, BLOCK, B, SEED, PURGE, CUT })).digest("hex");

// ---- signals on the hourly closes: h[k] = close at t - k hours (k = 0..72), undefined when missing ----
function ratio(h, a, b) { return h[a] === undefined || h[b] === undefined ? undefined : h[a] / h[b] - 1; }
function stdev(xs) { const m = xs.reduce((s, x) => s + x, 0) / xs.length; return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length); }
function hourlyReturns(h, from, to) { const out = []; for (let k = from; k < to; k += 1) { if (h[k] === undefined || h[k + 1] === undefined) return undefined; out.push(h[k] / h[k + 1] - 1); } return out; }
function volRatio(h) { const a = hourlyReturns(h, 0, 6); const b = hourlyReturns(h, 0, 72); if (a === undefined || b === undefined) return undefined; const d = stdev(b); return d > 0 ? stdev(a) / d : undefined; }
function window24(h, n) { const out = []; for (let k = 0; k <= n; k += 1) { if (h[k] === undefined) return undefined; out.push(h[k]); } return out; }
function closeVsMean(h, n) { const w = window24(h, n); if (w === undefined) return undefined; return w[0] / (w.reduce((s, x) => s + x, 0) / w.length) - 1; }
function extreme(h, n, pick) { const w = window24(h, n); if (w === undefined) return undefined; return w[0] / pick(...w) - 1; }

// ---- data (hard bound: never at or after CUT; no filling) ----
function parseWindow(name, value) {
  const t = Date.parse(value);
  if (!Number.isFinite(t) || t % H !== 0) throw new Error(`${name} must be a full UTC hour`);
  return t;
}
function checkWindows(w) {
  const { discoveryStart, discoveryEnd, holdbackStart, holdbackEnd } = w;
  if (!(discoveryStart < discoveryEnd && discoveryEnd + PURGE <= holdbackStart && holdbackStart < holdbackEnd)) throw new Error("windows must be ordered with a 96 hour purge between discovery and hold-back");
  if (holdbackEnd > CUT) throw new Error("the hold-back must end at or before 2026-11-20T00:00Z (reserved candle values are never read)");
  return w;
}
function loadHourly(db, market, from, to) {
  const lo = from - (LOOKBACK_HOURS + 1) * H;
  const closes = new Map();
  for (const r of db.prepare("SELECT close_time_ms AS t, close AS c FROM research_closed_candles WHERE market = ? AND interval_ms = ? AND close_time_ms >= ? AND close_time_ms <= ? ORDER BY close_time_ms ASC").iterate(market, M, lo, Math.min(to + 24 * H, CUT - M))) {
    const t = Number(r.t); const c = Number(r.c);
    if (t % H !== 0 || t >= CUT || !Number.isFinite(c) || c <= 0) continue;
    closes.set(t, c);
  }
  return closes;
}
function hoursBack(closes, t) { const h = new Array(LOOKBACK_HOURS + 1); for (let k = 0; k <= LOOKBACK_HOURS; k += 1) h[k] = closes.get(t - k * H); return h; }

/** Decision hours of one market in [from, to): the signal values (by id) for every hour with a usable lookback. */
function signalTable(closes, from, to) {
  const rows = [];
  for (let t = from; t < to; t += H) {
    if (!closes.has(t)) continue;
    const h = hoursBack(closes, t); const values = {};
    let any = false;
    for (const s of SIGNALS) { const v = s.f(h); if (v !== undefined && Number.isFinite(v)) { values[s.id] = v; any = true; } }
    if (any) rows.push({ t, values });
  }
  return rows;
}
function quantile(sorted, q) { if (sorted.length === 0) return undefined; const pos = (sorted.length - 1) * q; const lo = Math.floor(pos); const hi = Math.ceil(pos); return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo); }

/** Thresholds per signal and q, from the pooled DISCOVERY signal distribution only. */
function thresholdsFrom(tables) {
  const out = {};
  for (const s of SIGNALS) {
    const xs = [];
    for (const rows of tables) for (const r of rows) if (r.values[s.id] !== undefined) xs.push(r.values[s.id]);
    xs.sort((a, b) => a - b);
    out[s.id] = {};
    for (const q of QUANTILES) out[s.id][`q${Math.round(q * 100)}`] = xs.length ? { high: quantile(xs, q), low: quantile(xs, 1 - q), n: xs.length } : { high: undefined, low: undefined, n: 0 };
  }
  return out;
}

/** The trades of one rule in one market: non-overlapping (one position), long only, entry and exit at hourly closes. */
function tradesFor(rule, rows, closes, thresholds) {
  const th = thresholds[rule.signal][`q${Math.round(rule.q * 100)}`];
  const limit = rule.side === "HIGH" ? th.high : th.low;
  const out = []; let free = -Infinity; let unresolved = 0;
  if (limit === undefined) return { trades: out, unresolved };
  for (const r of rows) {
    if (r.t < free) continue;
    const v = r.values[rule.signal];
    if (v === undefined) continue;
    if (rule.side === "HIGH" ? v < limit : v > limit) continue;
    const exit = r.t + rule.hold * H;
    const a = closes.get(r.t); const b = closes.get(exit);
    if (a === undefined || b === undefined) { unresolved += 1; continue; }
    out.push({ t: r.t, gross: b / a - 1 });
    free = exit;
  }
  return { trades: out, unresolved };
}
const net = (trade, cost) => trade.gross - cost;
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const round = (x, d) => { const f = 10 ** d; return Math.round(x * f) / f; };

function evaluateRule(rule, perMarket, thresholds) {
  const trades = []; let unresolved = 0;
  for (const m of perMarket) {
    const r = tradesFor(rule, m.rows, m.closes, thresholds);
    unresolved += r.unresolved;
    for (const t of r.trades) trades.push({ market: m.market, t: t.t, gross: t.gross });
  }
  trades.sort((a, b) => a.t - b.t || (a.market < b.market ? -1 : 1));
  return { trades, unresolved };
}

function overlap(a, b) {
  const sa = new Set(a.map((t) => `${t.market}@${t.t}`)); let shared = 0;
  for (const t of b) if (sa.has(`${t.market}@${t.t}`)) shared += 1;
  return shared / Math.max(1, Math.min(a.length, b.length));
}

// ---- discover ----
function discover({ db, windows }) {
  const w = checkWindows(windows);
  const markets = [...BLIND_MARKETS, ...DISCOVERY_ONLY_MARKETS];
  const perMarket = markets.map((market) => { const closes = loadHourly(db, market, w.discoveryStart, w.discoveryEnd); return { market, closes, rows: signalTable(closes, w.discoveryStart, w.discoveryEnd) }; });
  const usable = perMarket.reduce((s, m) => s + m.rows.length, 0);
  if (usable === 0) return { status: "INSUFFICIENT_DATA", gridFingerprint: GRID_FINGERPRINT, trials: RULES.length, usableDecisionHours: 0 };
  const thresholds = thresholdsFrom(perMarket.map((m) => m.rows));
  const results = [];
  for (const rule of RULES) {
    const { trades, unresolved } = evaluateRule(rule, perMarket, thresholds);
    if (trades.length === 0) { results.push({ rule, trades, n: 0, meanNet: -Infinity, meanStress: -Infinity, unresolved }); continue; }
    results.push({ rule, trades, n: trades.length, meanNet: mean(trades.map((t) => net(t, COST))), meanStress: mean(trades.map((t) => net(t, STRESS_COST))), unresolved });
  }
  const eligible = results.filter((r) => r.n >= MIN_TRADES).sort((a, b) => b.meanNet - a.meanNet || (a.rule.id < b.rule.id ? -1 : 1));
  const shortlist = [];
  for (const cand of eligible) {
    if (shortlist.length >= MAX_SHORTLIST) break;
    if (shortlist.some((s) => overlap(s.trades, cand.trades) > MAX_OVERLAP)) continue;
    shortlist.push(cand);
  }
  return {
    status: shortlist.length === 0 ? "NO_SHORTLIST" : "SHORTLIST",
    gridFingerprint: GRID_FINGERPRINT, trials: RULES.length, usableDecisionHours: usable,
    eligibleRules: eligible.length, positiveMeanRules: results.filter((r) => r.meanNet > 0 && r.n >= MIN_TRADES).length,
    windows: { discoveryStart: w.discoveryStart, discoveryEnd: w.discoveryEnd, holdbackStart: w.holdbackStart, holdbackEnd: w.holdbackEnd, purgeHours: PURGE / H },
    shortlist: shortlist.map((s) => ({ id: s.rule.id, n: s.n, meanNet: round(s.meanNet, 6), meanStress: round(s.meanStress, 6), unresolved: s.unresolved })),
    thresholds: Object.fromEntries(shortlist.map((s) => { const th = thresholds[s.rule.signal][`q${Math.round(s.rule.q * 100)}`]; return [s.rule.id, { limit: round(s.rule.side === "HIGH" ? th.high : th.low, 8), n: th.n }]; })),
  };
}

/** The fingerprint binds the frozen content (not the creation time): the shortlist, thresholds, windows, alpha and the grid. */
function fingerprintOf(f) {
  return crypto.createHash("sha256").update(JSON.stringify({ study: f.study, gridFingerprint: f.gridFingerprint, windows: f.windows, shortlist: f.shortlist, thresholds: f.thresholds, alphaPerCandidate: f.alphaPerCandidate, sourceCommit: f.sourceCommit })).digest("hex");
}
function freezeRecord(result, nowIso, sourceCommit = null) {
  const body = { study: "HISTORY_MINING_V1", gridFingerprint: result.gridFingerprint, windows: result.windows, shortlist: result.shortlist.map((s) => s.id), thresholds: result.thresholds, alphaPerCandidate: ALPHA_TOTAL / Math.max(1, result.shortlist.length), sourceCommit, createdAt: nowIso, lookedAt: null };
  return { ...body, fingerprint: fingerprintOf(body) };
}

// ---- look: the one look at the hold-back ----
/**
 * Circular block bootstrap over TIME, not over the trade sequence: trades are summed into hourly bins (simultaneous trades of the correlated markets
 * stay together), blocks are 24 consecutive hour bins, the null is centred (each hour's sum minus m x its trade count) and the p-value is one-sided,
 * p = (1 + #{M* >= M - 1e-12}) / (B + 1) with M the observed mean net per trade. Zero variance (all trades equal) is not testable and gives p = 1.
 */
function timeBlockBootstrapP(items, from, to, random, resamples = B) {
  const bins = Math.max(0, Math.round((to - from) / H));
  const sums = new Array(bins).fill(0); const counts = new Array(bins).fill(0);
  let n = 0; let total = 0; let first = null; let varying = false;
  for (const it of items) {
    const i = Math.floor((it.t - from) / H);
    if (i < 0 || i >= bins) continue;
    sums[i] += it.v; counts[i] += 1; n += 1; total += it.v;
    if (first === null) first = it.v; else if (it.v !== first) varying = true;
  }
  if (n < 2 || bins === 0 || !varying) return 1;
  const m = total / n;
  const centred = sums.map((s, i) => s - m * counts[i]);
  let ge = 0;
  for (let b = 0; b < resamples; b += 1) {
    let num = 0; let den = 0; let filled = 0;
    while (filled < bins) { const start = Math.floor(random() * bins); for (let k = 0; k < BLOCK && filled < bins; k += 1) { const i = (start + k) % bins; num += centred[i]; den += counts[i]; filled += 1; } }
    const stat = den > 0 ? num / den : 0;
    if (stat >= m - 1e-12) ge += 1;
  }
  return (1 + ge) / (resamples + 1);
}

/** The descriptive PASS of the look: enough trades, mean net above zero at the base cost AND under the stress cost, p below the per-candidate alpha. */
function passDecision({ n, meanNet, meanStress, p, alpha }) { return n >= MIN_LOOK_TRADES && meanNet > 0 && meanStress > 0 && p < alpha; }

function look({ db, freeze, resamples = B }) {
  const w = checkWindows({ discoveryStart: freeze.windows.discoveryStart, discoveryEnd: freeze.windows.discoveryEnd, holdbackStart: freeze.windows.holdbackStart, holdbackEnd: freeze.windows.holdbackEnd });
  if (freeze.study !== "HISTORY_MINING_V1" || freeze.gridFingerprint !== GRID_FINGERPRINT) return { status: "FREEZE_MISMATCH" };
  if (freeze.lookedAt != null) return { status: "ALREADY_LOOKED" };
  if (freeze.fingerprint !== fingerprintOf(freeze)) return { status: "FREEZE_MISMATCH" };
  const perMarket = BLIND_MARKETS.map((market) => { const closes = loadHourly(db, market, w.holdbackStart, w.holdbackEnd); return { market, closes, rows: signalTable(closes, w.holdbackStart, w.holdbackEnd) }; });
  const thresholds = {};
  for (const s of SIGNALS) { thresholds[s.id] = {}; for (const q of QUANTILES) thresholds[s.id][`q${Math.round(q * 100)}`] = { high: undefined, low: undefined }; }
  const alpha = ALPHA_TOTAL / Math.max(1, freeze.shortlist.length);
  const out = [];
  for (const id of freeze.shortlist) {
    const rule = RULES.find((r) => r.id === id);
    if (!rule) return { status: "FREEZE_MISMATCH" };
    const frozen = freeze.thresholds[id];
    const th = thresholds[rule.signal][`q${Math.round(rule.q * 100)}`];
    if (rule.side === "HIGH") th.high = frozen.limit; else th.low = frozen.limit;
    const { trades, unresolved } = evaluateRule(rule, perMarket, thresholds);
    const xs = trades.map((t) => net(t, COST));
    const stress = mean(trades.map((t) => net(t, STRESS_COST)));
    const testable = xs.length >= MIN_LOOK_TRADES;
    const p = testable ? timeBlockBootstrapP(trades.map((t) => ({ t: t.t, v: net(t, COST) })), w.holdbackStart, w.holdbackEnd, makeRandom(SEED + out.length), resamples) : 1;
    // PASS (descriptive filter into forward confirmation): enough trades, mean net above zero at the base cost AND under the stress cost, p below the per-candidate alpha.
    out.push({ id, n: xs.length, testable, meanNet: round(mean(xs), 6), meanStress: round(stress, 6), unresolved, p: round(p, 4), pass: passDecision({ n: xs.length, meanNet: mean(xs), meanStress: stress, p, alpha }) });
  }
  return { status: out.some((c) => c.pass) ? "LOOK_PASS" : "LOOK_FAIL", alphaPerCandidate: alpha, candidates: out };
}

function main(argv) {
  const [phase, ...rest] = argv;
  const arg = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
  const { DatabaseSync } = require("node:sqlite");
  const dbPath = arg("db") || process.env.NUSA_CLOUD_STATE_DB_PATH;
  if (!dbPath) { console.error("HISTORY_MINING_ERROR no database path"); return 2; }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    if (phase === "discover") {
      const windows = { discoveryStart: parseWindow("discovery-start", arg("discovery-start")), discoveryEnd: parseWindow("discovery-end", arg("discovery-end")), holdbackStart: parseWindow("holdback-start", arg("holdback-start")), holdbackEnd: parseWindow("holdback-end", arg("holdback-end")) };
      const result = discover({ db, windows });
      console.log(`HISTORY_MINING_DISCOVER ${JSON.stringify(result)}`);
      if (result.shortlist) console.log(`HISTORY_MINING_FREEZE ${JSON.stringify(freezeRecord(result, new Date().toISOString(), (process.env.NUSA_SOURCE_COMMIT_SHA || "").trim() || null))}`);
      return 0;
    }
    if (phase === "look") {
      const freeze = JSON.parse(require("node:fs").readFileSync(arg("freeze"), "utf8"));
      console.log(`HISTORY_MINING_LOOK ${JSON.stringify(look({ db, freeze }))}`);
      return 0;
    }
    console.error("HISTORY_MINING_ERROR usage: discover|look");
    return 2;
  } catch (error) {
    console.error(`HISTORY_MINING_ERROR ${String(error && error.message).slice(0, 120)}`);
    return 2;
  } finally { db.close(); }
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { discover, look, freezeRecord, fingerprintOf, overlap, timeBlockBootstrapP, passDecision, checkWindows, loadHourly, signalTable, thresholdsFrom, tradesFor, RULES, SIGNALS, GRID_FINGERPRINT, CUT, PURGE, BLIND_MARKETS, DISCOVERY_ONLY_MARKETS, COST, STRESS_COST, MIN_TRADES, MIN_LOOK_TRADES };
