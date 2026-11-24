"use strict";
/**
 * Broad-universe discovery (docs/RESEARCH_BROAD_UNIVERSE_DISCOVERY_DESIGN_2026-11-24.md section 4 and 5 item 1; pre-registration of the looser bar
 * docs/RESEARCH_BROAD_UNIVERSE_LOOSER_FILTER_PREREG_2026-11-24.md). PAPER research only: reads research_closed_candles (1 m store shape) READ-ONLY, places
 * no order and writes nothing. scripts/run-history-mining.js is REQUIRED and not edited (the RET48 pre-registration and the spent H2 freeze pin it).
 *
 *   node scripts/run-broad-mining.js discover --db <store.sqlite> --markets <markets.json> --listing <listing.json>
 *
 * Differences from the H2 script: HIGH-side rules only (64 of the 128-rule grid, unchanged definitions); pooled over the tradable markets after a 30 day
 * listing wait; the excess baseline is TIME-MATCHED and LEAVE-ONE-OUT (the mean net of the same hour and hold over the OTHER tradable markets, only hours with
 * at least 10 markets that have a usable entry and exit bar); the decision p-value is the MAXIMUM over block lengths 24, 72 and 168; candidate conditions are
 * explicit and `NO_CANDIDATE` is a valid answer; trades are aggregated per rule (hour bins), never kept as objects. Output: counts, aggregates, thresholds and
 * rule ids; no price or candle value.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const mining = require("./run-history-mining.js");
const { makeRandom } = require("./run-crossmarket-study.js");

const H = 3_600_000;
const DAY = 24 * H;
const STUDY = "BROAD_UNIVERSE_V1";
const WINDOWS = Object.freeze({ discoveryStart: Date.parse("2021-12-20T00:00:00Z"), discoveryEnd: Date.parse("2023-07-01T00:00:00Z") });
const LISTING_WAIT = 30 * DAY;
const MIN_MARKETS_PER_HOUR = 10;
const MIN_TRADES = 100;
const MAX_SHORTLIST = 5;
const MAX_OVERLAP = 0.5;
const ALPHA_TOTAL = 0.05;
const BLOCKS = Object.freeze([24, 72, 168]);
const B = 10_000;
const SEED = 20261124;
const HIGH_RULES = Object.freeze(mining.RULES.filter((r) => r.side === "HIGH"));
const COST = mining.COST;
const STRESS_COST = mining.STRESS_COST;
const MARKET_RE = /^KRW-[A-Z0-9]{1,15}$/;

const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
const round = (x, d) => { const f = 10 ** d; return Math.round(x * f) / f; };

/** Fingerprint of everything that defines the study (not the data): rules, constants, windows, the frozen history grid and the market list. */
function gridFingerprint(markets, listing) {
  return sha(JSON.stringify({ STUDY, rules: HIGH_RULES.map((r) => r.id), historyGrid: mining.GRID_FINGERPRINT, WINDOWS, LISTING_WAIT, MIN_MARKETS_PER_HOUR, MIN_TRADES, MAX_SHORTLIST, MAX_OVERLAP, ALPHA_TOTAL, BLOCKS, B, SEED, COST, STRESS_COST, markets: [...markets].sort(), listing: Object.fromEntries(Object.keys(listing).sort().map((k) => [k, listing[k]])) }));
}

/** The bin version of mining.timeBlockBootstrapP: same centring, circular blocks over hour bins, one-sided p; identical result for the same random stream. */
function binBootstrapP(sums, counts, random, resamples, block) {
  const bins = sums.length; let n = 0; let total = 0;
  for (let i = 0; i < bins; i += 1) { n += counts[i]; total += sums[i]; }
  if (n < 2 || bins === 0) return 1;
  const m = total / n;
  const centred = new Float64Array(bins); let varying = false;
  for (let i = 0; i < bins; i += 1) { centred[i] = sums[i] - m * counts[i]; if (counts[i] > 0 && Math.abs(sums[i] / counts[i] - m) > 0) varying = true; }
  if (!varying) return 1;
  let ge = 0;
  for (let b = 0; b < resamples; b += 1) {
    let num = 0; let den = 0; let filled = 0;
    while (filled < bins) { const start = Math.floor(random() * bins); for (let k = 0; k < block && filled < bins; k += 1) { const i = (start + k) % bins; num += centred[i]; den += counts[i]; filled += 1; } }
    const stat = den > 0 ? num / den : 0;
    if (stat >= m - 1e-12) ge += 1;
  }
  return (1 + ge) / (resamples + 1);
}

/** Per hold: for every hour bin the sum and count of the always-in net return over all markets with a usable entry and exit bar. */
function baselines(perMarket, bins) {
  const out = new Map();
  for (const hold of [...new Set(HIGH_RULES.map((r) => r.hold))]) {
    const sum = new Float64Array(bins); const cnt = new Int32Array(bins);
    for (const m of perMarket) for (const r of m.rows) {
      const a = m.closes.get(r.t + H); const b = m.closes.get(r.t + H + hold * H);
      if (a === undefined || b === undefined) continue;
      const i = (r.t - WINDOWS.discoveryStart) / H; sum[i] += b / a - 1 - COST; cnt[i] += 1;
    }
    out.set(hold, { sum, cnt });
  }
  return out;
}

/** Aggregates of one rule over all markets; the trade list is never kept. */
function aggregateRule(rule, perMarket, thresholds, base, bins) {
  const marketCount = perMarket.length; const half = Math.floor(bins / 2);
  const agg = { id: rule.id, n: 0, unresolved: 0, skippedThinHours: 0, netSum: new Float64Array(bins), exSum: new Float64Array(bins), cnt: new Int32Array(bins), stress: 0, net: 0, ex: 0, halves: [{ n: 0, net: 0, ex: 0 }, { n: 0, net: 0, ex: 0 }], perMarket: {}, hit: new Uint8Array(marketCount * bins) };
  const b = base.get(rule.hold);
  perMarket.forEach((m, mi) => {
    const r = mining.tradesFor(rule, m.rows, m.closes, thresholds);
    agg.unresolved += r.unresolved;
    const pm = agg.perMarket[m.market] = { n: 0, ex: 0 };
    for (const t of r.trades) {
      const i = (t.t - WINDOWS.discoveryStart) / H;
      if (b.cnt[i] < MIN_MARKETS_PER_HOUR) { agg.skippedThinHours += 1; continue; }
      const own = t.gross - COST;
      const loo = (b.sum[i] - own) / (b.cnt[i] - 1); // the other markets of the same hour (own is among them by construction: a trade has both bars)
      const ex = own - loo;
      agg.n += 1; agg.net += own; agg.ex += ex; agg.stress += t.gross - STRESS_COST;
      agg.netSum[i] += own; agg.exSum[i] += ex; agg.cnt[i] += 1; agg.hit[mi * bins + i] = 1;
      const h = agg.halves[i < half ? 0 : 1]; h.n += 1; h.net += own; h.ex += ex;
      pm.n += 1; pm.ex += ex;
    }
  });
  return agg;
}

function overlapOf(a, b) {
  let shared = 0; for (let i = 0; i < a.hit.length; i += 1) if (a.hit[i] && b.hit[i]) shared += 1;
  return shared / Math.max(1, Math.min(a.n, b.n));
}

/** The candidate conditions of design section 4 except the p-value (all required). */
function passesLevelConditions(a) {
  if (a.n < MIN_TRADES) return false;
  if (!(a.net / a.n > 0 && a.stress / a.n > 0 && a.ex / a.n > 0)) return false;
  return a.halves.every((h) => h.n > 0 && h.net / h.n > 0 && h.ex / h.n > 0);
}

function loadMarkets(db, markets, listing) {
  return markets.map((market) => {
    const closes = mining.loadHourly(db, market, WINDOWS.discoveryStart, WINDOWS.discoveryEnd);
    const listedMs = listing[market];
    const startMs = Number.isFinite(listedMs) && listedMs > WINDOWS.discoveryStart ? listedMs + LISTING_WAIT : WINDOWS.discoveryStart; // listed before the window: treated as listed
    const rows = mining.signalTable(closes, Math.max(startMs, WINDOWS.discoveryStart), WINDOWS.discoveryEnd);
    return { market, closes, rows };
  }).filter((m) => m.closes.size > 0);
}

function discover({ db, markets, listing, resamples = B }) {
  if (!Array.isArray(markets) || markets.length < MIN_MARKETS_PER_HOUR || !markets.every((m) => MARKET_RE.test(m))) throw new Error("market list invalid");
  const bins = (WINDOWS.discoveryEnd - WINDOWS.discoveryStart) / H;
  const perMarket = loadMarkets(db, markets, listing);
  const usable = perMarket.reduce((s, m) => s + m.rows.length, 0);
  const common = { study: STUDY, gridFingerprint: gridFingerprint(markets, listing), trials: HIGH_RULES.length, windows: WINDOWS, marketsRequested: markets.length, marketsLoaded: perMarket.length, usableDecisionHours: usable, perMarketUsableHours: Object.fromEntries(perMarket.map((m) => [m.market, m.rows.length])) };
  if (perMarket.length < MIN_MARKETS_PER_HOUR || usable === 0) return { ...common, status: "INSUFFICIENT_DATA" };
  const thresholds = mining.thresholdsFrom(perMarket.map((m) => m.rows));
  const base = baselines(perMarket, bins);
  const aggs = HIGH_RULES.map((rule) => aggregateRule(rule, perMarket, thresholds, base, bins));
  const eligible = aggs.filter(passesLevelConditions).sort((a, b) => b.ex / b.n - a.ex / a.n || (a.id < b.id ? -1 : 1));
  const shortlist = [];
  for (const cand of eligible) {
    if (shortlist.length >= MAX_SHORTLIST) break;
    if (shortlist.some((s) => overlapOf(s, cand) > MAX_OVERLAP)) continue;
    shortlist.push(cand);
  }
  const alpha = ALPHA_TOTAL / Math.max(1, shortlist.length);
  const table = shortlist.map((a, idx) => {
    const pBlocks = BLOCKS.map((block, k) => binBootstrapP(a.exSum, a.cnt, makeRandom(SEED + idx * 10 + k), resamples, block));
    const pMax = Math.max(...pBlocks);
    const rule = HIGH_RULES.find((r) => r.id === a.id); const th = thresholds[rule.signal][`q${Math.round(rule.q * 100)}`];
    return { id: a.id, n: a.n, meanNet: round(a.net / a.n, 6), meanStress: round(a.stress / a.n, 6), meanExcess: round(a.ex / a.n, 6), pExcessByBlock: pBlocks.map((p) => round(p, 4)), pExcessMax: round(pMax, 4),
      halves: a.halves.map((h) => ({ n: h.n, meanNet: round(h.net / h.n, 6), meanExcess: round(h.ex / h.n, 6) })), candidate: pMax < alpha, limit: round(th.high, 8), thresholdN: th.n,
      marketsTraded30: Object.values(a.perMarket).filter((x) => x.n >= 30).length, marketsPositive30: Object.values(a.perMarket).filter((x) => x.n >= 30 && x.ex > 0).length, unresolved: a.unresolved, skippedThinHours: a.skippedThinHours };
  });
  const candidates = table.filter((t) => t.candidate);
  return { ...common, status: candidates.length === 0 ? "NO_CANDIDATE" : "CANDIDATES", alphaPerCandidate: alpha, eligibleRules: eligible.length, positiveMeanRules: aggs.filter((a) => a.n >= MIN_TRADES && a.net / a.n > 0).length, shortlist: table, candidates: candidates.map((c) => c.id) };
}

function fingerprintOf(f) {
  return sha(JSON.stringify({ study: f.study, gridFingerprint: f.gridFingerprint, windows: f.windows, shortlist: f.shortlist, thresholds: f.thresholds, alphaPerCandidate: f.alphaPerCandidate, markets: f.markets, sourceCommit: f.sourceCommit }));
}
/** The freeze record is committed BEFORE the descriptive hold-back run; the shortlist of the record is the candidates only. */
function freezeRecord(result, markets, nowIso, sourceCommit = null) {
  const keep = result.shortlist.filter((s) => s.candidate);
  const body = { study: STUDY, gridFingerprint: result.gridFingerprint, windows: result.windows, shortlist: keep.map((s) => s.id), thresholds: Object.fromEntries(keep.map((s) => [s.id, { limit: s.limit, n: s.thresholdN }])), alphaPerCandidate: result.alphaPerCandidate, markets: [...markets].sort(), sourceCommit, createdAt: nowIso, vetoedAt: null };
  return { ...body, fingerprint: fingerprintOf(body) };
}

function main(argv) {
  const [phase, ...rest] = argv;
  const arg = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
  if (phase !== "discover") { console.error("BROAD_MINING_ERROR usage: discover"); return 2; }
  try {
    const { DatabaseSync } = require("node:sqlite");
    const dbPath = arg("db"); if (!dbPath) throw new Error("no database path");
    const markets = JSON.parse(fs.readFileSync(arg("markets"), "utf8")); const listing = JSON.parse(fs.readFileSync(arg("listing"), "utf8"));
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const result = discover({ db, markets, listing });
      console.log(`BROAD_MINING_DISCOVER ${JSON.stringify(result)}`);
      if (result.shortlist && result.candidates && result.candidates.length) console.log(`BROAD_MINING_FREEZE ${JSON.stringify(freezeRecord(result, markets, new Date().toISOString(), (process.env.NUSA_SOURCE_COMMIT_SHA || "").trim() || null))}`);
      return 0;
    } finally { db.close(); }
  } catch (error) { console.error(`BROAD_MINING_ERROR ${String(error && error.message).slice(0, 120)}`); return 2; }
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { discover, freezeRecord, fingerprintOf, binBootstrapP, baselines, aggregateRule, passesLevelConditions, gridFingerprint, HIGH_RULES, WINDOWS, STUDY, MIN_MARKETS_PER_HOUR };
