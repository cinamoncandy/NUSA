"use strict";
/**
 * Forward confirmation of the RET48 rules (docs/RESEARCH_PREREG_2026-11-24_FORWARD_CONFIRMATION_RET48_H24.md, section 7 step 1).
 * PAPER research only: reads research_closed_candles (1 m) READ-ONLY, places no order and writes nothing.
 *
 *   node scripts/run-history-mining-forward.js evaluate --db <state.sqlite> --freeze <freeze-record.json> --span-start <ISO> [--committed <quarterly.json>]
 *   node scripts/run-history-mining-forward.js quarter-hash --db <state.sqlite> --at <ISO>
 *
 * `evaluate` is the ONE decision; it refuses to run before 2028-03-31T00:00Z. `quarter-hash` prints hashes and counts only (never a value).
 * The frozen pure functions of run-history-mining.js are imported unchanged; this file never edits them (GRID_FINGERPRINT includes CUT).
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const mining = require("./run-history-mining.js");
const { makeRandom } = require("./run-crossmarket-study.js");

const M = 60_000;
const H = 60 * M;
const DAY = 24 * H;
const SPAN_EARLIEST = Date.parse("2026-12-11T00:00:00Z");
const DECISION = Date.parse("2028-03-31T00:00:00Z");
const MARKETS = Object.freeze(["KRW-BTC", "KRW-ETH", "KRW-SOL", "KRW-NEAR"]); // XRP stays discovery-only
const RULE_LIMITS = Object.freeze({ RET48_HIGH_Q90_H24: 0.06434783, RET48_HIGH_Q80_H24: 0.03293838 }); // frozen thresholds, checked against the freeze record
const PRIMARY = "RET48_HIGH_Q90_H24";
const SECONDARY = "RET48_HIGH_Q80_H24";
const SEED = 20261121;
const B = 10_000;
const BLOCK = 24;
const ALPHA = 0.05;
const MIN_TRADES = 200;
const MAX_MISSING_SHARE = 0.10;
const LOOKBACK_H = 72;
const SETTLING_MS = 7 * DAY;
const FROZEN_FINGERPRINT = "dc65065c8d898668263abe774f53088dde2e35dfdf39eb9f1f601760556fdaa5";

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const round = (x, d) => { const f = 10 ** d; return Math.round(x * f) / f; };
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

/** The frozen record must be the committed H2 record: fingerprint, grid and both limits unchanged. */
function verifyFreeze(freeze) {
  if (!freeze || freeze.study !== "HISTORY_MINING_V1") return "FREEZE_MISMATCH";
  if (freeze.fingerprint !== FROZEN_FINGERPRINT || freeze.fingerprint !== mining.fingerprintOf(freeze)) return "FREEZE_MISMATCH";
  if (freeze.gridFingerprint !== mining.GRID_FINGERPRINT) return "FREEZE_MISMATCH";
  for (const [id, limit] of Object.entries(RULE_LIMITS)) if (!freeze.thresholds || !freeze.thresholds[id] || freeze.thresholds[id].limit !== limit) return "FREEZE_MISMATCH";
  return null;
}

/** Top-of-hour closes of one market in [from - 73 h, to + 25 h]; no filling of holes. */
function loadHourly(db, market, from, to) {
  const lo = from - (LOOKBACK_H + 1) * H;
  const closes = new Map();
  for (const r of db.prepare("SELECT close_time_ms AS t, close AS c FROM research_closed_candles WHERE market = ? AND interval_ms = ? AND close_time_ms >= ? AND close_time_ms <= ? ORDER BY close_time_ms ASC").iterate(market, M, lo, to + 25 * H)) {
    const t = Number(r.t); const c = Number(r.c);
    if (t % H !== 0 || !Number.isFinite(c) || c <= 0) continue;
    closes.set(t, c);
  }
  return closes;
}

/** Share of hours of [from, to) without a top-of-hour bar, per market. */
function missingShares(perMarket, from, to) {
  const hours = Math.round((to - from) / H);
  return perMarket.map((m) => { let have = 0; for (let t = from; t < to; t += H) if (m.closes.has(t)) have += 1; return { market: m.market, hours, have, missingShare: hours > 0 ? 1 - have / hours : 1 }; });
}

/** SHA-256 over the ordered rows (market, close time, close) of [from, to), with counts. */
function spanHash(perMarket, from, to) {
  const h = crypto.createHash("sha256"); let rows = 0;
  for (const m of [...perMarket].sort((a, b) => (a.market < b.market ? -1 : 1))) for (let t = from; t < to; t += H) { const c = m.closes.get(t); if (c === undefined) continue; h.update(`${m.market}|${t}|${c}\n`); rows += 1; }
  return { sha256: h.digest("hex"), rows };
}

/**
 * Quarterly record (prereg section 6): rows older than 7 days at `atMs`: (a) hash over (market, close time), (b) hash over (market, close time, close), counts,
 * and per market-day counts and hashes so a later check can find a changed or deleted row.
 */
function quarterRecord(db, atMs) {
  const cutoff = atMs - SETTLING_MS;
  const a = crypto.createHash("sha256"); const b = crypto.createHash("sha256"); const days = {}; let rows = 0;
  for (const market of MARKETS) {
    for (const r of db.prepare("SELECT close_time_ms AS t, close AS c FROM research_closed_candles WHERE market = ? AND interval_ms = ? AND close_time_ms < ? ORDER BY close_time_ms ASC").iterate(market, M, cutoff)) {
      const t = Number(r.t); const c = Number(r.c);
      if (t % H !== 0 || !Number.isFinite(c) || c <= 0) continue;
      a.update(`${market}|${t}\n`); b.update(`${market}|${t}|${c}\n`); rows += 1;
      const d = `${market}|${Math.floor(t / DAY)}`; const e = days[d] || (days[d] = { n: 0, hT: crypto.createHash("sha256"), hTC: crypto.createHash("sha256") });
      e.n += 1; e.hT.update(`${t}\n`); e.hTC.update(`${t}|${c}\n`);
    }
  }
  const perDay = {}; for (const [k, e] of Object.entries(days)) perDay[k] = { n: e.n, hT: e.hT.digest("hex").slice(0, 16), hTC: e.hTC.digest("hex").slice(0, 16) };
  return { at: new Date(atMs).toISOString(), cutoff: new Date(cutoff).toISOString(), rows, hashA: a.digest("hex"), hashB: b.digest("hex"), perDay };
}

/**
 * Compare a committed quarterly record with the store now: a day with the same count must have the same hashes (a changed close or a swapped row fails);
 * a day with fewer rows (a deleted row) fails; a day with MORE rows is a tolerated late gap-fill. Known limit: a hash cannot prove that the earlier rows of a day
 * that gained a row are unchanged; the day is only checked by count growth.
 */
function checkCommitted(committed, current) {
  for (const [k, was] of Object.entries(committed.perDay)) {
    const now = current.perDay[k];
    if (!now || now.n < was.n) return { ok: false, reason: `ROW_DELETED ${k}` };
    if (now.n === was.n && (now.hT !== was.hT || now.hTC !== was.hTC)) return { ok: false, reason: `ROW_CHANGED ${k}` };
  }
  return { ok: true };
}

function evaluateRuleSet(perMarket, from, decision, thresholds, resamples) {
  const out = {};
  const baseline = mining.baselineFor(24, perMarket);
  const net = (t, c) => t.gross - c;
  for (const [id, seedOffset] of [[PRIMARY, 0], [SECONDARY, 1]]) {
    const rule = mining.RULES.find((r) => r.id === id);
    const trades = []; let unresolved = 0;
    for (const m of perMarket) { const r = mining.tradesFor(rule, m.rows, m.closes, thresholds); unresolved += r.unresolved; for (const t of r.trades) trades.push({ market: m.market, t: t.t, gross: t.gross }); }
    trades.sort((x, y) => x.t - y.t || (x.market < y.market ? -1 : 1));
    const netItems = trades.map((t) => ({ t: t.t, v: net(t, mining.COST) }));
    const excessItems = trades.map((t) => ({ t: t.t, v: mining.excessOf(t, baseline) }));
    const testable = trades.length >= MIN_TRADES;
    const boot = (items, off) => (testable ? mining.timeBlockBootstrapP(items, from, decision, makeRandom(SEED + off), resamples, BLOCK) : 1);
    const p = boot(netItems, seedOffset); const pExcess = boot(excessItems, 1000 + seedOffset);
    const meanNet = mean(netItems.map((x) => x.v)); const meanStress = mean(trades.map((t) => net(t, mining.STRESS_COST))); const excess = mean(excessItems.map((x) => x.v));
    const pass = testable && mining.passDecision({ n: trades.length, meanNet, meanStress, p, alpha: ALPHA, excess, pExcess });
    out[id] = { n: trades.length, unresolved, testable, meanNet: round(meanNet, 6), meanStress: round(meanStress, 6), excess: round(excess, 6), p: round(p, 4), pExcess: round(pExcess, 4), pass, tables: mining.signTables(trades, baseline) };
  }
  return out;
}

/** The decision. `perMarket` = [{ market, closes }] covering the span plus lookback; pure and testable on synthetic data. */
function decide({ perMarket, spanStart, decisionAt = DECISION, resamples = B }) {
  if (!(spanStart >= SPAN_EARLIEST) || spanStart % H !== 0) return { status: "BAD_SPAN_START" };
  const missing = missingShares(perMarket, spanStart, decisionAt);
  if (missing.some((m) => m.missingShare > MAX_MISSING_SHARE)) return { status: "DATA_INTEGRITY_FAIL", reason: "MISSING_HOURS", missing: missing.map((m) => ({ market: m.market, hours: m.hours, have: m.have })) };
  const windowEnd = decisionAt - 24 * H; // decision hours up to decision - 25 h inclusive
  const withRows = perMarket.map((m) => ({ market: m.market, closes: m.closes, rows: mining.signalTable(m.closes, spanStart, windowEnd) }));
  const thresholds = {};
  for (const s of mining.SIGNALS) { thresholds[s.id] = {}; for (const q of [0.8, 0.9]) thresholds[s.id][`q${Math.round(q * 100)}`] = { high: undefined, low: undefined }; }
  thresholds.RET48.q90.high = RULE_LIMITS[PRIMARY]; thresholds.RET48.q80.high = RULE_LIMITS[SECONDARY];
  const res = evaluateRuleSet(withRows, spanStart, decisionAt, thresholds, resamples);
  const primary = res[PRIMARY];
  const secondaryCounts = primary.pass && res[SECONDARY].pass;
  const status = !primary.testable ? "INCONCLUSIVE" : primary.pass ? "PASS" : "FAIL";
  return { status, entryRule: mining.ENTRY_RULE, spanStart: new Date(spanStart).toISOString(), decisionAt: new Date(decisionAt).toISOString(), primary, secondary: { ...res[SECONDARY], countsForTheDecision: primary.pass, passes: secondaryCounts }, spanHash: spanHash(perMarket, spanStart, decisionAt), missing: missing.map((m) => ({ market: m.market, hours: m.hours, have: m.have })) };
}

function evaluate({ db, freeze, spanStart, committed = [], now = Date.now(), resamples = B }) {
  if (now < DECISION) return { status: "TOO_EARLY", notBefore: new Date(DECISION).toISOString() };
  const bad = verifyFreeze(freeze); if (bad) return { status: bad };
  const perMarket = MARKETS.map((market) => ({ market, closes: loadHourly(db, market, spanStart, DECISION) }));
  const current = quarterRecord(db, DECISION);
  for (const c of committed) { const r = checkCommitted(c, current); if (!r.ok) return { status: "DATA_INTEGRITY_FAIL", reason: r.reason }; }
  const out = decide({ perMarket, spanStart, resamples });
  if (out.status === "BAD_SPAN_START") return out;
  out.committedChecked = committed.length; out.pairingFreeze = freeze.fingerprint;
  return out;
}

function arg(argv, name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; }
function main(argv) {
  const cmd = argv[0];
  const { DatabaseSync } = require("node:sqlite");
  const dbPath = arg(argv, "--db"); if (!dbPath) throw new Error("--db is required");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    if (cmd === "quarter-hash") { const at = Date.parse(arg(argv, "--at")); if (!Number.isFinite(at)) throw new Error("--at must be an ISO time"); console.log(`FORWARD_QUARTER_HASH ${JSON.stringify(quarterRecord(db, at))}`); return 0; }
    if (cmd === "evaluate") {
      const freeze = JSON.parse(fs.readFileSync(arg(argv, "--freeze"), "utf8")); const rec = freeze.freeze || freeze;
      const spanStart = Date.parse(arg(argv, "--span-start"));
      const cpath = arg(argv, "--committed"); const committed = cpath ? JSON.parse(fs.readFileSync(cpath, "utf8")) : [];
      const out = evaluate({ db, freeze: rec, spanStart, committed });
      console.log(`FORWARD_DECISION ${JSON.stringify(out)}`);
      return out.status === "PASS" || out.status === "FAIL" || out.status === "INCONCLUSIVE" ? 0 : 1;
    }
    throw new Error("usage: evaluate | quarter-hash");
  } finally { db.close(); }
}
if (require.main === module) { try { process.exit(main(process.argv.slice(2))); } catch (e) { console.error(`ERROR ${e.message}`); process.exit(1); } }
module.exports = { verifyFreeze, decide, evaluate, quarterRecord, checkCommitted, spanHash, missingShares, loadHourly, DECISION, SPAN_EARLIEST, MARKETS, RULE_LIMITS, PRIMARY, SECONDARY };
