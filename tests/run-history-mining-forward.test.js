"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const f = require("../scripts/run-history-mining-forward.js");

const H = 3_600_000;
const DAY = 24 * H;
const freezeFile = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "docs", "research-data", "history-mining-h2-freeze-record-2026-11-23.json"), "utf8"));
const freeze = freezeFile.freeze;
const START = f.SPAN_EARLIEST;

/** Synthetic made-up series only (no market information). */
function series(from, to, { holeEvery = 0, seedShift = 0 } = {}) {
  const closes = new Map(); let p = 100; let s = 12345 + seedShift;
  for (let t = from - 80 * H; t <= to + 30 * H; t += H) {
    s = (s * 1103515245 + 12345) % 2147483648; const r = s / 2147483648 - 0.5;
    p *= 1 + r * 0.04;
    if (holeEvery && (t / H) % holeEvery === 0) continue;
    closes.set(t, p);
  }
  return closes;
}
const markets = (opts) => f.MARKETS.map((m, i) => ({ market: m, closes: series(START, START + 120 * DAY, { ...opts, seedShift: i * 7 }) }));

test("the frozen record is the committed H2 record; a changed limit or fingerprint is refused", () => {
  assert.equal(f.verifyFreeze(freeze), null);
  assert.equal(f.verifyFreeze({ ...freeze, thresholds: { ...freeze.thresholds, RET48_HIGH_Q90_H24: { limit: 0.07 } } }), "FREEZE_MISMATCH");
  assert.equal(f.verifyFreeze({ ...freeze, fingerprint: "0".repeat(64) }), "FREEZE_MISMATCH");
  assert.equal(f.verifyFreeze({ ...freeze, study: "OTHER" }), "FREEZE_MISMATCH");
});

test("refuses to decide before 2028-03-31T00:00Z", () => {
  const db = new DatabaseSync(":memory:");
  assert.equal(f.evaluate({ db, freeze, spanStart: START, now: f.DECISION - 1 }).status, "TOO_EARLY");
  db.close();
});

test("the span may not start before 2026-12-11T00:00Z", () => {
  assert.equal(f.decide({ perMarket: markets(), spanStart: START - H, decisionAt: START + 60 * DAY, resamples: 50 }).status, "BAD_SPAN_START");
});

test("more than 10 percent of hours missing in a market voids the study", () => {
  const out = f.decide({ perMarket: markets({ holeEvery: 5 }), spanStart: START, decisionAt: START + 60 * DAY, resamples: 50 });
  assert.equal(out.status, "DATA_INTEGRITY_FAIL");
  assert.equal(out.reason, "MISSING_HOURS");
});

test("a decision is PASS, FAIL or INCONCLUSIVE with the frozen counts; the secondary counts only if the primary passes", () => {
  const out = f.decide({ perMarket: markets(), spanStart: START, decisionAt: START + 120 * DAY, resamples: 200 });
  assert.ok(["PASS", "FAIL", "INCONCLUSIVE"].includes(out.status));
  assert.equal(out.entryRule, "NEXT_HOURLY_CLOSE");
  assert.equal(out.secondary.countsForTheDecision, out.primary.pass);
  if (out.primary.n < 200) assert.equal(out.status, "INCONCLUSIVE");
  assert.match(out.spanHash.sha256, /^[0-9a-f]{64}$/);
  const again = f.decide({ perMarket: markets(), spanStart: START, decisionAt: START + 120 * DAY, resamples: 200 });
  assert.deepEqual(again, out, "deterministic (fixed seeds)");
});

test("fewer than 200 resolved primary trades is INCONCLUSIVE, never a pass", () => {
  const out = f.decide({ perMarket: markets(), spanStart: START, decisionAt: START + 30 * DAY, resamples: 50 });
  assert.equal(out.status, "INCONCLUSIVE");
  assert.equal(out.primary.pass, false);
});

function store(rows) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE research_closed_candles (market TEXT, interval_ms INTEGER, close_time_ms INTEGER, close REAL)");
  const ins = db.prepare("INSERT INTO research_closed_candles (market, interval_ms, close_time_ms, close) VALUES (?, 60000, ?, ?)");
  for (const [m, t, c] of rows) ins.run(m, t, c);
  return db;
}
const baseRows = () => { const r = []; for (const m of f.MARKETS) for (let i = 0; i < 72; i += 1) r.push([m, START + i * H, 100 + i]); return r; };
const AT = START + 30 * DAY;

test("quarterly record: a late added bar is tolerated; a changed close, a deleted row and a rebuilt store are rejected", () => {
  const rows = baseRows();
  const committed = f.quarterRecord(store(rows), AT);
  assert.equal(committed.rows, rows.length);
  const added = rows.concat([[f.MARKETS[0], START + 80 * H, 5]]);
  assert.equal(f.checkCommitted(committed, f.quarterRecord(store(added), AT)).ok, true);
  const changed = rows.map((r, i) => (i === 3 ? [r[0], r[1], r[2] + 1] : r));
  assert.match(f.checkCommitted(committed, f.quarterRecord(store(changed), AT)).reason, /ROW_CHANGED/);
  assert.match(f.checkCommitted(committed, f.quarterRecord(store(rows.slice(1)), AT)).reason, /ROW_DELETED/);
  assert.match(f.checkCommitted(committed, f.quarterRecord(store([]), AT)).reason, /ROW_DELETED/);
});

test("rows younger than 7 days at the record time are not part of it", () => {
  const rows = baseRows().concat([[f.MARKETS[0], AT - 2 * DAY, 9]]);
  assert.equal(f.quarterRecord(store(rows), AT).rows, baseRows().length);
});

test("the script prints no candle value: its output keys are counts, hashes, p-values and trade statistics only", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "run-history-mining-forward.js"), "utf8");
  assert.doesNotMatch(src, /console\.log\([^)]*closes/);
  assert.equal((src.match(/console\.log/g) || []).length, 2);
});
