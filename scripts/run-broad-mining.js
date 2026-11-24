"use strict";
/**
 * Broad-universe discovery (docs/RESEARCH_BROAD_UNIVERSE_DISCOVERY_DESIGN_2026-11-24.md section 4 and 5 item 1; pre-registration of the looser bar
 * docs/RESEARCH_BROAD_UNIVERSE_LOOSER_FILTER_PREREG_2026-11-24.md). PAPER research only: reads research_closed_candles (1 m store shape) READ-ONLY, places
 * no order and writes nothing. scripts/run-history-mining.js is REQUIRED and not edited (the RET48 pre-registration and the spent H2 freeze pin it).
 *
 *   NUSA_SOURCE_COMMIT_SHA=<40 hex> node scripts/run-broad-mining.js discover --db <store.sqlite> --markets <markets.json> --listing <listing.json> --tiers <tiers.json>
 *
 * Differences from the H2 script: HIGH-side rules only (64 of the 128-rule grid, unchanged definitions); pooled over the tradable markets after a 30 day
 * listing wait; the excess baseline is TIME-MATCHED and LEAVE-ONE-OUT (the mean net of the same hour and hold over the OTHER tradable markets, only hours with
 * at least 10 markets that have a usable entry and exit bar); the decision p-value is the MAXIMUM over block lengths 24, 72 and 168; candidate conditions are
 * explicit and `NO_CANDIDATE` is a valid answer; trades are aggregated per rule (hour bins), never kept as objects. Output: counts, aggregates, thresholds and
 * rule ids; no price or candle value.
 *
 * Costs (design section 3 cost model): per market, round trip = 0.10 percent fee + one tick over price as a spread floor; stress = 0.30 percent + twice the floor.
 * The floor of a market is the tick of its tier (the committed tier table, the LARGER of the two boundary readings) divided by the median close of the window.
 * The EXCESS is measured on GROSS returns (own gross minus the mean gross of the other markets at the same hour), so market-specific costs never enter the
 * baseline; the cost conditions (base and stress net above 0) are applied on the per-market costs. The bootstrap p-value of the excess does NOT account for
 * the choice among 64 rules (descriptive; the verdict comes from the forward test).
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const mining = require("./run-history-mining.js");
const filterCount = require("./broad-universe-filter-count.js");
const { makeRandom } = require("./run-crossmarket-study.js");

const H = 3_600_000;
const DAY = 24 * H;
const STUDY = "BROAD_UNIVERSE_V1";
const WINDOWS = Object.freeze({ discoveryStart: Date.parse("2021-12-20T00:00:00Z"), discoveryEnd: Date.parse("2023-07-01T00:00:00Z") });
const LISTING_WAIT = 30 * DAY;
const MIN_MARKETS_PER_HOUR = 10; // counts the trading market itself: the leave-one-out baseline then uses at least 9 other markets
const MIN_TRADES = 100;
const MAX_SHORTLIST = 5;
const MAX_OVERLAP = 0.5;
const ALPHA_TOTAL = 0.05;
const BLOCKS = Object.freeze([24, 72, 168]);
const B = 10_000;
const SEED = 20261124;
const HIGH_RULES = Object.freeze(mining.RULES.filter((r) => r.side === "HIGH"));
const FEE_ROUND_TRIP = mining.COST; // 0.10 percent
const STRESS_FEE_ROUND_TRIP = mining.STRESS_COST; // 0.30 percent
const MIN_HALF_TRADES = 20;
const MARKET_RE = /^KRW-[A-Z0-9]{1,15}$/;

const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
const round = (x, d) => { const f = 10 ** d; return Math.round(x * f) / f; };

/** Fingerprint of everything that defines the study (not the data): rules, constants, windows, the frozen history grid and the market list. */
function gridFingerprint(markets, listing, tierTable = []) {
  return sha(JSON.stringify({ STUDY, rules: HIGH_RULES.map((r) => r.id), historyGrid: mining.GRID_FINGERPRINT, WINDOWS, LISTING_WAIT, MIN_MARKETS_PER_HOUR, MIN_TRADES, MAX_SHORTLIST, MAX_OVERLAP, MIN_HALF_TRADES, ALPHA_TOTAL, BLOCKS, B, SEED, FEE_ROUND_TRIP, STRESS_FEE_ROUND_TRIP, tierTable, markets: [...markets].sort(), listing: Object.fromEntries(Object.keys(listing).sort().map((k) => [k, listing[k]])) }));
}

/** The bin version of mining.timeBlockBootstrapP: same centring, circular blocks over hour bins, one-sided p; identical result for the same random stream. */
function binBootstrapP(sums, counts, random, resamples, block, varyingFlag) {
  const bins = sums.length; let n = 0; let total = 0;
  for (let i = 0; i < bins; i += 1) { n += counts[i]; total += sums[i]; }
  if (n < 2 || bins === 0) return 1;
  const m = total / n;
  const centred = new Float64Array(bins); let varying = false;
  for (let i = 0; i < bins; i += 1) { centred[i] = sums[i] - m * counts[i]; if (counts[i] > 0 && Math.abs(sums[i] / counts[i] - m) > 1e-12) varying = true; }
  if (varyingFlag !== undefined) varying = varyingFlag; // the caller knows whether the item values themselves differ (as the frozen function does)
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
      const i = (r.t - WINDOWS.discoveryStart) / H; sum[i] += b / a - 1; cnt[i] += 1; // gross: the excess never carries market-specific costs
    }
    out.set(hold, { sum, cnt });
  }
  return out;
}

/** Aggregates of one rule over all markets; the trade list is never kept. */
function aggregateRule(rule, perMarket, thresholds, base, bins) {
  const marketCount = perMarket.length; const half = Math.floor(bins / 2);
  const agg = { id: rule.id, n: 0, unresolved: 0, skippedThinHours: 0, netSum: new Float64Array(bins), exSum: new Float64Array(bins), cnt: new Int32Array(bins), stress: 0, net: 0, ex: 0, exMin: Infinity, exMax: -Infinity, halves: [{ n: 0, net: 0, ex: 0 }, { n: 0, net: 0, ex: 0 }], perMarket: {}, hit: new Uint8Array(marketCount * bins) };
  const b = base.get(rule.hold);
  perMarket.forEach((m, mi) => {
    const r = mining.tradesFor(rule, m.rows, m.closes, thresholds);
    agg.unresolved += r.unresolved;
    const pm = agg.perMarket[m.market] = { n: 0, ex: 0 };
    for (const t of r.trades) {
      const i = (t.t - WINDOWS.discoveryStart) / H;
      if (b.cnt[i] < MIN_MARKETS_PER_HOUR) { agg.skippedThinHours += 1; continue; }
      const own = t.gross - (FEE_ROUND_TRIP + m.floor);
      const loo = (b.sum[i] - t.gross) / (b.cnt[i] - 1); // the other markets of the same hour (own is among them by construction: a trade has both bars)
      const ex = t.gross - loo;
      agg.n += 1; agg.net += own; agg.ex += ex; agg.stress += t.gross - (STRESS_FEE_ROUND_TRIP + m.floor); agg.exMin = Math.min(agg.exMin, ex); agg.exMax = Math.max(agg.exMax, ex);
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
  return a.halves.every((h) => h.n >= MIN_HALF_TRADES && h.net / h.n > 0 && h.ex / h.n > 0);
}

function tiersFrom(tierTable) {
  if (!Array.isArray(tierTable) || tierTable.length === 0 || !tierTable.every((x) => Number.isFinite(x?.tick) && x.tick > 0 && x.lowestCurrentPrice > 0 && x.highestCurrentPrice >= x.lowestCurrentPrice)) throw new Error("tier table invalid");
  return { lowest: new Map(tierTable.map((x) => [x.tick, x.lowestCurrentPrice])), highest: new Map(tierTable.map((x) => [x.tick, x.highestCurrentPrice])) };
}
const medianOf = (xs) => { const v = [...xs].sort((x, y) => x - y); const n = v.length; return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2; };

/** The listing map must name every market with a finite time; the wait starts at the next full hour. */
function checkInputs(markets, listing, tierTable) {
  if (!Array.isArray(markets) || markets.length < MIN_MARKETS_PER_HOUR || !markets.every((m) => MARKET_RE.test(m)) || new Set(markets).size !== markets.length) throw new Error("market list invalid");
  if (listing === null || typeof listing !== "object" || Array.isArray(listing)) throw new Error("listing map invalid");
  for (const m of markets) if (!Number.isFinite(listing[m])) throw new Error("listing map misses a market");
  tiersFrom(tierTable);
}

function loadMarkets(db, markets, listing, tierTable) {
  const tiers = tiersFrom(tierTable);
  return markets.map((market) => {
    const closes = mining.loadHourly(db, market, WINDOWS.discoveryStart, WINDOWS.discoveryEnd);
    const listedMs = Math.ceil(listing[market] / H) * H;
    const startMs = listedMs > WINDOWS.discoveryStart ? listedMs + LISTING_WAIT : WINDOWS.discoveryStart; // listed before the window: treated as listed
    const rows = mining.signalTable(closes, Math.max(startMs, WINDOWS.discoveryStart), WINDOWS.discoveryEnd);
    let floor = 0;
    if (rows.length > 0) {
      const med = medianOf(rows.map((r) => closes.get(r.t)));
      floor = Math.max(filterCount.tickAt(med, tiers, "low"), filterCount.tickAt(med, tiers, "high")) / med; // the larger tick of the two boundary readings: conservative
    }
    return { market, closes, rows, floor };
  }).filter((m) => m.closes.size > 0);
}

function discover({ db, markets, listing, tierTable, resamples = B }) {
  checkInputs(markets, listing, tierTable);
  const bins = (WINDOWS.discoveryEnd - WINDOWS.discoveryStart) / H;
  const perMarket = loadMarkets(db, markets, listing, tierTable);
  if (perMarket.length < markets.length) throw new Error("a requested market has no candles");
  const usable = perMarket.reduce((s, m) => s + m.rows.length, 0);
  const common = { study: STUDY, gridFingerprint: gridFingerprint(markets, listing, tierTable), pValueNote: "descriptive: the p-values do not account for the choice among the 64 rules", trials: HIGH_RULES.length, windows: WINDOWS, marketsRequested: markets.length, marketsLoaded: perMarket.length, usableDecisionHours: usable, perMarketUsableHours: Object.fromEntries(perMarket.map((m) => [m.market, m.rows.length])) };
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
    const pBlocks = BLOCKS.map((block, k) => binBootstrapP(a.exSum, a.cnt, makeRandom(SEED + idx * 10 + k), resamples, block, a.exMax > a.exMin));
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
  return sha(JSON.stringify({ study: f.study, gridFingerprint: f.gridFingerprint, windows: f.windows, shortlist: f.shortlist, thresholds: f.thresholds, alphaPerCandidate: f.alphaPerCandidate, shortlistSize: f.shortlistSize, status: f.status, markets: f.markets, sourceCommit: f.sourceCommit }));
}
/** The freeze record is committed BEFORE the descriptive hold-back run; the shortlist of the record is the candidates only. */
function freezeRecord(result, markets, nowIso, sourceCommit) {
  if (!/^[0-9a-f]{40}$/.test(String(sourceCommit))) throw new Error("source commit sha required");
  const keep = result.shortlist.filter((s) => s.candidate);
  const body = { study: STUDY, gridFingerprint: result.gridFingerprint, windows: result.windows, shortlist: keep.map((s) => s.id), thresholds: Object.fromEntries(keep.map((s) => [s.id, { limit: s.limit, n: s.thresholdN }])), alphaPerCandidate: result.alphaPerCandidate ?? null, shortlistSize: result.shortlist.length, status: result.status, markets: [...markets].sort(), sourceCommit, createdAt: nowIso, vetoedAt: null, pValueNote: result.pValueNote };
  return { ...body, fingerprint: fingerprintOf(body) };
}

function main(argv) {
  const [phase, ...rest] = argv;
  const arg = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
  if (phase !== "discover") { console.error("BROAD_MINING_ERROR usage: discover"); return 2; }
  try {
    const { DatabaseSync } = require("node:sqlite");
    const dbPath = arg("db"); if (!dbPath) throw new Error("no database path");
    const markets = JSON.parse(fs.readFileSync(arg("markets"), "utf8")); const listing = JSON.parse(fs.readFileSync(arg("listing"), "utf8")); const tierTable = JSON.parse(fs.readFileSync(arg("tiers"), "utf8"));
    const sourceCommit = (process.env.NUSA_SOURCE_COMMIT_SHA || "").trim();
    if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error("NUSA_SOURCE_COMMIT_SHA (40 hex) is required");
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const result = discover({ db, markets, listing, tierTable });
      console.log(`BROAD_MINING_DISCOVER ${JSON.stringify(result)}`);
      if (result.shortlist) console.log(`BROAD_MINING_FREEZE ${JSON.stringify(freezeRecord(result, markets, new Date().toISOString(), sourceCommit))}`); // also for NO_CANDIDATE: a stop is recorded too
      return 0;
    } finally { db.close(); }
  } catch (error) { console.error(`BROAD_MINING_ERROR ${String(error && error.message).slice(0, 120)}`); return 2; }
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { discover, checkInputs, tiersFrom, freezeRecord, fingerprintOf, binBootstrapP, baselines, aggregateRule, passesLevelConditions, gridFingerprint, HIGH_RULES, WINDOWS, STUDY, MIN_MARKETS_PER_HOUR };
