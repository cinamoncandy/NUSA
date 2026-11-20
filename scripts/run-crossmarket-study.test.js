"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const S = require("./run-crossmarket-study.js");

const M = 60_000;
const H = 3_600_000;
const { START, VAL, HOLD, END, MARKETS } = S;
const FROM = START - 24 * H - H;

function emptyDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE research_closed_candles (market TEXT NOT NULL, interval_ms INTEGER NOT NULL, close_time_ms INTEGER NOT NULL, open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL, checksum TEXT NOT NULL, volume REAL, PRIMARY KEY (market, interval_ms, close_time_ms))");
  db.exec("CREATE TABLE research_candle_absence (market TEXT NOT NULL, interval_ms INTEGER NOT NULL, first_absent_close_ms INTEGER NOT NULL, last_absent_close_ms INTEGER NOT NULL, before_close_ms INTEGER NOT NULL, after_close_ms INTEGER NOT NULL, evidence_fingerprint_sha256 TEXT NOT NULL, observed_at TEXT NOT NULL, checksum TEXT NOT NULL, PRIMARY KEY (market, interval_ms, first_absent_close_ms, last_absent_close_ms))");
  db.exec("CREATE TABLE research_orderbook_samples (market TEXT NOT NULL, captured_at_ms INTEGER NOT NULL, best_bid REAL NOT NULL, best_ask REAL NOT NULL, bid_size_5 REAL NOT NULL, ask_size_5 REAL NOT NULL, total_bid_size REAL NOT NULL, total_ask_size REAL NOT NULL, PRIMARY KEY (market, captured_at_ms))");
  return db;
}

/**
 * Hourly log-returns per market: `drift(i, h)` plus noise; minute closes interpolate geometrically inside the hour.
 * `halfSpread` is the relative half spread of a book written at every full hour and every five minutes.
 */
function syntheticDb({ drift, noise = 0.001, halfSpread = 0.0001, skipBooks = () => false, skipMinutes = () => false, markets = MARKETS, samePrice = false } = {}) {
  const db = emptyDb();
  const candle = db.prepare("INSERT INTO research_closed_candles VALUES (?, ?, ?, ?, ?, ?, ?, 'x', 1)");
  const book = db.prepare("INSERT INTO research_orderbook_samples VALUES (?, ?, ?, ?, 1, 1, 10, 10)");
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  db.exec("BEGIN");
  markets.forEach((market, i) => {
    let price = samePrice ? 1000 : 1000 * (i + 1);
    const hours = (END - FROM) / H;
    for (let h = 0; h < hours; h += 1) {
      const next = price * Math.exp(drift(i, h) + (rand() - 0.5) * 2 * noise);
      for (let k = 1; k <= 60; k += 1) {
        const t = FROM + h * H + k * M; const p = price * (next / price) ** (k / 60);
        if (!skipMinutes(i, t)) candle.run(market, M, t, p, p, p, p);
        if (k % 5 === 0 && !skipBooks(i, t)) book.run(market, t, p * (1 - halfSpread), p * (1 + halfSpread));
      }
      price = next;
    }
  });
  db.exec("COMMIT");
  return db;
}
// A market whose drift is a step function of the 36-hour block: the 24 h trailing return then predicts the next hour.
const blockDrift = (i, h) => ((((Math.floor(h / 36) * 7 + i * 3) % 5) - 2) * 0.004);
const noDrift = () => 0;
const AFTER = END + 31 * M;

test("the span, bar and constants are the ones in the document", () => {
  assert.equal(START, Date.parse("2026-11-21T00:00:00Z"));
  assert.equal(VAL, Date.parse("2026-11-28T00:00:00Z"));
  assert.equal(HOLD, Date.parse("2026-11-30T00:00:00Z"));
  assert.equal(END, Date.parse("2026-12-10T00:00:00Z"));
  assert.equal(S.K, 4);
  assert.equal(S.BAR, 0.0125);
  assert.equal(S.SEED, 20261119);
  assert.deepEqual([...MARKETS], ["KRW-BTC", "KRW-DOGE", "KRW-ETH", "KRW-SOL", "KRW-XRP"]);
  assert.deepEqual(S.PRIMARY, { lookback: 24 * H, hold: H });
  assert.equal(S.DESCRIPTIVE.length, 3);
});

test("splitmix64 and xoshiro256** reproduce the published reference values", () => {
  assert.equal(S.splitmix64(0)(), 0xe220a8397b1dcdafn);
  const next = S.xoshiro256ss([1n, 2n, 3n, 4n]);
  assert.deepEqual([next(), next(), next(), next()], [11520n, 0n, 1509978240n, 1215971899390074240n]);
  const a = S.makeRandom(); const b = S.makeRandom();
  for (let i = 0; i < 50; i += 1) { const u = a(); assert.equal(u, b()); assert.ok(u >= 0 && u < 1); }
});

test("Student t, ranks and Spearman follow their definitions", () => {
  // t = 2.2281 with 10 degrees of freedom is the one-sided 0.025 point.
  assert.ok(Math.abs(S.incompleteBeta(10 / (10 + 2.2281 ** 2), 5, 0.5) * 0.5 - 0.025) < 5e-4);
  const sample = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((v) => v + 4);
  assert.ok(S.studentOneSidedP(sample) < 1e-4);
  assert.ok(S.studentOneSidedP(sample.map((v) => -v)) > 0.99);
  assert.deepEqual(S.averageRanks([3, 1, 3, 2]), [3.5, 1, 3.5, 2]);
  assert.equal(S.spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.equal(S.spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
  assert.equal(S.spearman([1, 1, 1], [1, 2, 3]), undefined);
});

test("the bootstrap and the sign-flip permutation reject a clear positive mean and keep a centred one", () => {
  const strong = Array.from({ length: 240 }, (_, i) => 1 + (i % 3) * 0.1);
  assert.ok(S.blockBootstrapP(strong) < 0.0125);
  assert.ok(S.blockSignFlipP(strong) < 0.0125);
  const centred = Array.from({ length: 96 }, (_, i) => (i % 2 === 0 ? 1 : -1));
  assert.ok(S.blockBootstrapP(centred) > 0.3);
  assert.ok(S.blockSignFlipP(centred) > 0.3);
  assert.equal(S.blockBootstrapP(strong), S.blockBootstrapP(strong));
});

test("waits until 30 minutes after the end and then reads values", () => {
  const db = syntheticDb({ drift: noDrift });
  const early = S.runStudy({ db, now: START + 3.5 * 24 * H });
  assert.equal(early.status, "WAITING_DATA"); assert.equal(early.daysCollected, 3);
  assert.deepEqual(Object.keys(early.coverageMinutes), [...MARKETS]);
  assert.equal(S.runStudy({ db, now: END + 29 * M }).status, "WAITING_DATA");
  assert.notEqual(S.runStudy({ db, now: AFTER }).status, "WAITING_DATA");
});

test("a row stamped after the run time is a data integrity failure", () => {
  const db = syntheticDb({ drift: noDrift });
  db.prepare("INSERT INTO research_closed_candles VALUES ('KRW-BTC', ?, ?, 1, 1, 1, 1, 'x', 1)").run(M, AFTER + 60_000);
  assert.deepEqual(S.runStudy({ db, now: AFTER }), { status: "DATA_INTEGRITY_FAIL", reasonCode: "DATA_FUTURE" });
});

test("a planted momentum edge passes every stage and the result is deterministic", { timeout: 300_000 }, () => {
  const db = syntheticDb({ drift: blockDrift, noise: 0.0005 });
  const r = S.runStudy({ db, now: AFTER });
  assert.equal(r.status, "HOLDOUT_PASS", JSON.stringify(r));
  assert.equal(r.eligible, 5);
  assert.ok(r.primary.trades >= 200 && r.primary.meanNetBp > 0 && r.primary.meanStressBp > 0);
  assert.ok(r.primary.pairedMeanBp > 0 && r.primary.pairedP < 0.0125 && r.stageOne.pass);
  assert.equal(r.descriptive.length, 3);
  assert.match(r.datasetFingerprint, /^[0-9a-f]{64}$/);
  assert.deepEqual(S.runStudy({ db, now: AFTER }), r);
});

test("pure noise does not pass", { timeout: 300_000 }, () => {
  const db = syntheticDb({ drift: noDrift, noise: 0.004 });
  const r = S.runStudy({ db, now: AFTER });
  assert.equal(r.status, "HOLDOUT_FAIL", JSON.stringify(r));
  assert.ok(r.primary.trades >= 200);
});

test("negative control: a momentum edge smaller than the costs fails after costs", { timeout: 300_000 }, () => {
  const db = syntheticDb({ drift: (i, h) => blockDrift(i, h) * 0.02, noise: 0.0005 });
  const r = S.runStudy({ db, now: AFTER });
  assert.equal(r.status, "HOLDOUT_FAIL", JSON.stringify(r));
  assert.ok(r.primary.meanNetBp < 0);
});

test("a market with a wide spread or thin coverage is not eligible; fewer than 3 eligible markets is INSUFFICIENT_DATA", { timeout: 300_000 }, () => {
  const wide = syntheticDb({ drift: blockDrift, halfSpread: 0.0001 });
  wide.exec("UPDATE research_orderbook_samples SET best_bid = best_bid * 0.99, best_ask = best_ask * 1.01 WHERE market IN ('KRW-BTC', 'KRW-DOGE', 'KRW-ETH')");
  const r = S.runStudy({ db: wide, now: AFTER });
  assert.equal(r.status, "INSUFFICIENT_DATA"); assert.equal(r.eligible, 2);
  // A market with a third of its books missing in training (below 90 percent) drops out; four remain and the study still runs.
  const thin = syntheticDb({ drift: blockDrift, skipBooks: (i, t) => i === 0 && t >= START && t < VAL && Math.floor(t / H) % 3 !== 0 });
  const t = S.runStudy({ db: thin, now: AFTER });
  assert.equal(t.eligible, 4); assert.ok(!t.eligibleMarkets.includes("KRW-BTC"));
});

test("a bar with a missing minute is incomplete unless the minute has an absence proof", () => {
  const hole = START + 5 * H + 17 * M;
  const db = syntheticDb({ drift: noDrift, skipMinutes: (i, t) => i === 0 && t === hole });
  const s = S.loadMarket(db, "KRW-BTC", AFTER);
  const hourEnd = START + 6 * H;
  assert.equal(S.barComplete(s, hourEnd), false);
  assert.equal(S.barComplete(s, START + 7 * H), true);
  db.prepare("INSERT INTO research_candle_absence VALUES ('KRW-BTC', ?, ?, ?, ?, ?, 'f', '2026-12-10T00:00:00Z', 'x')").run(M, hole, hole, hole - M, hole + M);
  assert.equal(S.barComplete(S.loadMarket(db, "KRW-BTC", AFTER), hourEnd), true);
});

test("the book at t is the last sample in (t - 2 min, t] and must be usable", () => {
  const db = emptyDb();
  const put = db.prepare("INSERT INTO research_orderbook_samples VALUES ('KRW-BTC', ?, ?, ?, 1, 1, 1, 1)");
  const t = START + 3 * H;
  put.run(t - 3 * M, 100, 101); put.run(t - M, 100, 101); put.run(t + M, 50, 51);
  assert.equal(S.bookAt(S.loadMarket(db, "KRW-BTC", AFTER), t).t, t - M);
  db.exec(`DELETE FROM research_orderbook_samples WHERE captured_at_ms = ${t - M}`);
  assert.equal(S.bookAt(S.loadMarket(db, "KRW-BTC", AFTER), t), undefined, "a sample older than two minutes is not used, nothing after t is used");
  put.run(t - M, 101, 100);
  assert.equal(S.bookAt(S.loadMarket(db, "KRW-BTC", AFTER), t), undefined, "a crossed book is not usable");
});

test("timing: the decision uses the close at t and the entry is the ask at t, never anything after t", () => {
  const db = syntheticDb({ drift: blockDrift, noise: 0.0005 });
  const eligible = MARKETS.map((m) => S.loadMarket(db, m, AFTER));
  const base = S.cellTrades(eligible, S.PRIMARY, HOLD, END).trades;
  // Rewrite every candle and book strictly after t = HOLD + 100 h: decisions up to that hour must not change.
  const cut = HOLD + 100 * H;
  db.exec(`UPDATE research_closed_candles SET close = close * 3 WHERE close_time_ms > ${cut}`);
  db.exec(`UPDATE research_orderbook_samples SET best_bid = best_bid * 3, best_ask = best_ask * 3 WHERE captured_at_ms > ${cut}`);
  const changed = S.cellTrades(MARKETS.map((m) => S.loadMarket(db, m, AFTER)), S.PRIMARY, HOLD, END).trades;
  const sameUntil = (a, b) => a.filter((r) => r.t < cut).map((r) => `${r.t}${r.market}`).join() === b.filter((r) => r.t < cut).map((r) => `${r.t}${r.market}`).join();
  assert.ok(sameUntil(base, changed));
});

test("part-end rule: an exit exactly at the part end is kept, one after it is dropped and counted", () => {
  const db = syntheticDb({ drift: blockDrift });
  const eligible = MARKETS.map((m) => S.loadMarket(db, m, AFTER));
  const part = S.cellTrades(eligible, { lookback: 24 * H, hold: 4 * H }, HOLD, HOLD + 10 * H);
  assert.equal(part.trades.length, 7); // decisions at +0..+6 h exit by +10 h; +7..+9 h are dropped
  assert.equal(part.drops.exitAfterPartEnd, 3);
  assert.equal(part.trades[part.trades.length - 1].t, HOLD + 6 * H);
});

test("ties are broken by market code order", () => {
  const db = syntheticDb({ drift: () => 0.001, noise: 0, samePrice: true });
  const eligible = MARKETS.map((m) => S.loadMarket(db, m, AFTER));
  const { trades } = S.cellTrades(eligible, S.PRIMARY, HOLD, HOLD + 5 * H);
  assert.ok(trades.length > 0);
  for (const r of trades) assert.equal(r.market, "KRW-BTC");
});

test("fewer than 3 eligible markets at an hour skips the hour", () => {
  const db = syntheticDb({ drift: blockDrift, skipBooks: (i, t) => i >= 2 && t >= HOLD + 5 * H && t < HOLD + 8 * H });
  const eligible = MARKETS.map((m) => S.loadMarket(db, m, AFTER));
  const part = S.cellTrades(eligible, S.PRIMARY, HOLD, HOLD + 20 * H);
  assert.ok(part.skippedHours >= 2);
});

test("the module prints one fixed CROSSMARKET_STUDY line and fails closed without a state path", () => {
  const bad = spawnSync(process.execPath, [require.resolve("./run-crossmarket-study.js")], { env: { ...process.env, NUSA_CLOUD_STATE_DB_PATH: "" }, encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /CROSSMARKET_STUDY_FAILED_CLOSED/);
});
