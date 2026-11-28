#!/usr/bin/env node
"use strict";
// Alpha Lab cohort 1: forward recorder and anytime-valid e-process for three pre-registered cross-section hypotheses.
// Registration: docs/RESEARCH_PREREG_2026-11-28_ALPHA_LAB_COHORT1.md. Method: docs/ALPHA_LAB_V3_CROSS_SECTION_EVALUE_DESIGN_2026-11-27.md
// sections 2 and 7 (top third equal weight versus the equal basket, 15 bp per side on turnover, clip at 4 sd of past days, 20-day
// burn-in, fixed lambda grid averaged with a predictable adaptive bet, threshold 1/alpha).
// Commands:
//   node scripts/alpha-lab/cohort1.js record <recordsDir>   fetch closed daily candles, append today's rows (idempotent), write status
//   node scripts/alpha-lab/cohort1.js self-test             synthetic checks only (no network)
// OFFLINE / hosted runner only. No host access, no order path, no secret. PAPER_ONLY, aiAuthority=ZERO_AUTHORITY.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DAY_MS = 86_400_000;
const ROOT = path.resolve(__dirname, "../..");
const UNIVERSE_FILE = "docs/research-data/broad-universe-filter-count-20bp-2026-11-24.json";
const UNIVERSE_SHA256 = "8c145fed3cd2e0d88919418ff7c2c3af0fd1a62e02efa6c1a9c3872211ea330d";
const FIRST_SIGNAL_DAY = Date.UTC(2026, 11, 6); // 2026-12-06: first close used as a signal; earlier lookback days were holdout until 2026-12-05
const COST = 0.0015, ALPHA = 0.0125, BURN_IN = 20, CLIP_SD = 4, MIN_MARKETS = 20;
const LAMBDAS = Object.freeze([0.02, 0.05, 0.1, 0.2, 0.35, 0.5]);
const HYPOTHESES = Object.freeze([
  Object.freeze({ id: "C1_LOWVOL20_H20", signal: "low_volatility_20d", hold: 20 }),
  Object.freeze({ id: "C1_REV28_H20", signal: "long_term_reversal_28d", hold: 20 }),
  Object.freeze({ id: "C1_STR1_H5", signal: "short_term_reversal_1d", hold: 5 }),
]);

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Signal at the close of day t from closes through t only. Higher value = more wanted. */
function signalValue(closes, signal, t) {
  const c = closes.get(t);
  if (!(c > 0)) return null;
  if (signal === "short_term_reversal_1d") { const p = closes.get(t - DAY_MS); return p > 0 ? -(c / p - 1) : null; }
  if (signal === "long_term_reversal_28d") { const p = closes.get(t - 28 * DAY_MS); return p > 0 ? -(c / p - 1) : null; }
  if (signal === "low_volatility_20d") {
    const r = [];
    for (let k = 0; k < 20; k += 1) { const a = closes.get(t - k * DAY_MS), b = closes.get(t - (k + 1) * DAY_MS); if (!(a > 0 && b > 0)) return null; r.push(Math.log(a / b)); }
    const m = r.reduce((x, y) => x + y, 0) / r.length;
    return -Math.sqrt(r.reduce((x, y) => x + (y - m) ** 2, 0) / (r.length - 1));
  }
  throw new Error("UNKNOWN_SIGNAL:" + signal);
}

/** Holdings formed at the close of day t: top third (rounded) by signal, equal weight; ties broken by market name. */
function holdingsAt(universe, closesByMarket, signal, t) {
  const scored = [];
  for (const m of universe) { const v = signalValue(closesByMarket.get(m) || new Map(), signal, t); if (v != null && Number.isFinite(v) && closesByMarket.get(m).get(t + DAY_MS) > 0) scored.push([m, v]); }
  if (scored.length < MIN_MARKETS) return null;
  scored.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const k = Math.round(scored.length / 3), w = {};
  for (let i = 0; i < k; i += 1) w[scored[i][0]] = 1 / k;
  return { weights: w, eligible: scored.map((s) => s[0]) };
}

/** One day's net excess of the held tilt over the equal basket of the same eligible markets, return from close t to close t+1. */
function dayExcess(closesByMarket, h, prevWeights, t) {
  let hold = 0, basket = 0, turn = 0;
  for (const m of h.eligible) { const r = closesByMarket.get(m).get(t + DAY_MS) / closesByMarket.get(m).get(t) - 1; basket += r / h.eligible.length; hold += (h.weights[m] || 0) * r; }
  const keys = new Set([...Object.keys(h.weights), ...Object.keys(prevWeights || {})]);
  for (const m of keys) turn += Math.abs((h.weights[m] || 0) - ((prevWeights || {})[m] || 0));
  return { gross: hold - basket, net: hold - basket - COST * turn, turnover: turn };
}

/** e-process over the net excess series: mean of (fixed grid mixture, adaptive predictable bet), each 0.5. */
function eProcess(xs) {
  const e = LAMBDAS.map(() => 1); let eA = 1, ys = 0, yq = 0, ny = 0, value = 1, passDay = null;
  for (let i = 0; i < xs.length; i += 1) {
    if (i >= BURN_IN) {
      const past = xs.slice(0, i), m = past.reduce((a, b) => a + b, 0) / past.length;
      const sd = Math.sqrt(past.reduce((a, b) => a + (b - m) ** 2, 0) / (past.length - 1));
      const y = sd > 0 ? Math.max(-1, Math.min(1, xs[i] / (CLIP_SD * sd))) : 0;
      let mix = 0; for (let k = 0; k < LAMBDAS.length; k += 1) { e[k] *= 1 + LAMBDAS[k] * y; mix += e[k]; }
      const lam = ny < 5 ? 0 : Math.max(0, Math.min(0.5, (ys / ny) / Math.max(1e-6, yq / ny)));
      eA *= 1 + lam * y; ys += y; yq += y * y; ny += 1;
      value = 0.5 * eA + 0.5 * (mix / LAMBDAS.length);
      if (passDay == null && value >= 1 / ALPHA) passDay = i;
    }
  }
  return { value, passDayIndex: passDay, evaluatedDays: Math.max(0, xs.length - BURN_IN) };
}

/** Build all rows from day FIRST_SIGNAL_DAY to lastClosedDay - 1 (each row needs the next close). Pure function of the candles. */
function buildRows(universe, closesByMarket, lastClosedDay) {
  const out = {};
  for (const hy of HYPOTHESES) {
    const rows = []; let cur = null, prevW = null, sinceRebalance = 0;
    for (let t = FIRST_SIGNAL_DAY; t + DAY_MS <= lastClosedDay; t += DAY_MS) {
      let rebalance = cur == null || sinceRebalance >= hy.hold;
      let h = rebalance ? holdingsAt(universe, closesByMarket, hy.signal, t) : cur;
      if (h == null) { rows.push({ day: iso(t), status: "NO_DATA" }); cur = null; continue; }
      // A held market without a next close is a data gap: record it and do not invent a return.
      if (!h.eligible.every((m) => closesByMarket.get(m).get(t + DAY_MS) > 0 && closesByMarket.get(m).get(t) > 0)) { rows.push({ day: iso(t), status: "NO_DATA" }); continue; }
      const x = dayExcess(closesByMarket, h, rebalance ? prevW : h.weights, t);
      if (rebalance) { prevW = h.weights; cur = h; sinceRebalance = 0; }
      sinceRebalance += 1;
      rows.push({ day: iso(t), status: "OK", rebalance, holdings: Object.keys(h.weights).sort(), eligible: h.eligible.length, gross: +x.gross.toFixed(8), net: +x.net.toFixed(8), turnover: +x.turnover.toFixed(6) });
    }
    out[hy.id] = rows;
  }
  return out;
}

function chain(rows) { let prev = "0".repeat(64); return rows.map((r) => { const body = JSON.stringify({ ...r, prev }); prev = sha256(body); return { ...r, prev, hash: prev }; }); }

async function fetchCloses(universe, throughDay) {
  const byMarket = new Map();
  const from = FIRST_SIGNAL_DAY - 40 * DAY_MS;
  for (const m of universe) {
    const closes = new Map(); let to = throughDay + DAY_MS;
    for (let page = 0; page < 5; page += 1) {
      const q = new URLSearchParams({ market: m, count: "200", to: new Date(to).toISOString().slice(0, 19) });
      let res, attempt = 0;
      for (;;) { res = await fetch("https://api.upbit.com/v1/candles/days?" + q, { headers: { Accept: "application/json", "User-Agent": "NUSA-Alpha-Lab-Cohort1/1.0" }, signal: AbortSignal.timeout(20000) }); if (res.ok || attempt >= 3 || (res.status !== 429 && res.status < 500)) break; attempt += 1; await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt)); }
      if (!res.ok) throw new Error("UPBIT_HTTP_" + res.status + ":" + m);
      const batch = await res.json(); if (!Array.isArray(batch) || batch.length === 0) break;
      let oldest = Infinity;
      for (const c of batch) { const d = Date.parse(c.candle_date_time_utc + "Z"); if (d <= throughDay && d >= from && c.trade_price > 0) closes.set(d, Number(c.trade_price)); oldest = Math.min(oldest, d); }
      if (oldest <= from || batch.length < 200) break; to = oldest;
      await new Promise((r) => setTimeout(r, 150));
    }
    byMarket.set(m, closes);
  }
  return byMarket;
}

function loadUniverse() {
  const raw = fs.readFileSync(path.join(ROOT, UNIVERSE_FILE));
  if (sha256(raw) !== UNIVERSE_SHA256) throw new Error("UNIVERSE_SHA256_MISMATCH");
  const d = JSON.parse(raw.toString("utf8"));
  return [...new Set([...d.discoveryPool, ...d.forwardPool, "KRW-BTC"])].sort();
}

async function record(dir) {
  const now = Date.now(), lastClosedDay = Math.floor(now / DAY_MS) * DAY_MS - DAY_MS; // yesterday's UTC candle is closed
  if (lastClosedDay < FIRST_SIGNAL_DAY + DAY_MS) { console.log("COHORT1 WAITING first signal day " + iso(FIRST_SIGNAL_DAY) + " (first row needs the next close)"); return; }
  const universe = loadUniverse(), closes = await fetchCloses(universe, lastClosedDay);
  const rows = buildRows(universe, closes, lastClosedDay);
  fs.mkdirSync(dir, { recursive: true });
  const status = { schemaVersion: 1, cohort: "ALPHA_LAB_COHORT1", recordedAt: new Date(now).toISOString(), lastClosedDay: iso(lastClosedDay), hypotheses: {} };
  for (const hy of HYPOTHESES) {
    const file = path.join(dir, hy.id + ".jsonl");
    const chained = chain(rows[hy.id]);
    // Append-only: rows already on file must be byte-identical to the recomputed ones (a changed past row is refused).
    const old = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
    for (let i = 0; i < old.length; i += 1) if (old[i] !== JSON.stringify(chained[i])) throw new Error("PAST_ROW_CHANGED:" + hy.id + ":" + i);
    fs.writeFileSync(file, chained.map((r) => JSON.stringify(r)).join("\n") + (chained.length ? "\n" : ""));
    const xs = rows[hy.id].filter((r) => r.status === "OK").map((r) => r.net);
    const ep = eProcess(xs);
    status.hypotheses[hy.id] = { okDays: xs.length, noDataDays: rows[hy.id].length - xs.length, evaluatedDays: ep.evaluatedDays, eValue: +ep.value.toFixed(6), threshold: 1 / ALPHA, verdict: ep.passDayIndex != null ? "PASS" : "OPEN", lastHash: chained.length ? chained[chained.length - 1].hash : null };
  }
  fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(status, null, 2) + "\n");
  console.log("COHORT1 " + JSON.stringify(status.hypotheses));
}

function selfTest() {
  const assert = (c, m) => { if (!c) throw new Error("SELF_TEST:" + m); };
  // e-process: a null (zero-mean symmetric) series never passes in 200 runs; a strong drift passes.
  let s = 7; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  let nullPass = 0; for (let k = 0; k < 200; k += 1) { const xs = Array.from({ length: 365 }, () => gauss()); if (eProcess(xs).passDayIndex != null) nullPass += 1; }
  assert(nullPass <= 3, "null passes " + nullPass);
  assert(eProcess(Array.from({ length: 365 }, () => 0.6 + gauss())).passDayIndex != null, "strong drift passes");
  // Signals use only closes through t.
  const closes = new Map(); for (let i = 0; i < 40; i += 1) closes.set(FIRST_SIGNAL_DAY - (39 - i) * DAY_MS, 100 + i);
  const v = signalValue(closes, "short_term_reversal_1d", FIRST_SIGNAL_DAY); assert(v < 0, "reversal sign");
  closes.set(FIRST_SIGNAL_DAY + DAY_MS, 1e9); assert(signalValue(closes, "short_term_reversal_1d", FIRST_SIGNAL_DAY) === v, "no look-ahead");
  // Chain: any edit changes the hash.
  const c1 = chain([{ a: 1 }, { a: 2 }]), c2 = chain([{ a: 1 }, { a: 3 }]); assert(c1[0].hash === c2[0].hash && c1[1].hash !== c2[1].hash, "chain");
  console.log("COHORT1 SELF_TEST PASS (null passes " + nullPass + "/200)");
}

if (require.main === module) {
  const [cmd, dir] = process.argv.slice(2);
  if (cmd === "record" && dir) record(dir).catch((e) => { console.error("COHORT1_FAILED " + (e && e.message)); process.exit(1); });
  else if (cmd === "self-test") selfTest();
  else { console.error("usage: cohort1.js record <dir> | self-test"); process.exit(2); }
}
module.exports = { HYPOTHESES, FIRST_SIGNAL_DAY, signalValue, holdingsAt, dayExcess, eProcess, buildRows, chain, selfTest };
