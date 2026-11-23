"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { makeRandom } = require("./run-crossmarket-study.js");
const S = require("./run-signal-screen.js");

const M = 60_000;
const H = 3_600_000;
const FROM = Date.parse("2026-12-07T00:00:00Z");
const { ELIG_START, SCREEN_START, SCREEN_END, EARLIEST_RUN } = S;
const AFTER = EARLIEST_RUN + 60_000;

function emptyDb() {
  const d = new DatabaseSync(":memory:");
  d.exec("CREATE TABLE research_closed_candles (market TEXT NOT NULL, interval_ms INTEGER NOT NULL, close_time_ms INTEGER NOT NULL, open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL, checksum TEXT NOT NULL, volume REAL, PRIMARY KEY (market, interval_ms, close_time_ms))");
  d.exec("CREATE TABLE research_candle_absence (market TEXT NOT NULL, interval_ms INTEGER NOT NULL, first_absent_close_ms INTEGER NOT NULL, last_absent_close_ms INTEGER NOT NULL, before_close_ms INTEGER NOT NULL, after_close_ms INTEGER NOT NULL, evidence_fingerprint_sha256 TEXT NOT NULL, observed_at TEXT NOT NULL, checksum TEXT NOT NULL, PRIMARY KEY (market, interval_ms, first_absent_close_ms, last_absent_close_ms))");
  return d;
}
/** Hourly log drifts per market; minute closes interpolate inside the hour. `skip(i, t)` drops a minute. */
function syntheticDb({ drift, noise = 0.001, skip = () => false } = {}) {
  const d = emptyDb();
  const ins = d.prepare("INSERT INTO research_closed_candles VALUES (?, 60000, ?, ?, ?, ?, ?, 'x', ?)");
  let seed = 5;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  d.exec("BEGIN");
  S.MARKETS.forEach((market, i) => {
    let price = 1000 * (i + 1);
    const hours = (SCREEN_END - FROM) / H;
    for (let h = 0; h < hours; h += 1) {
      const next = price * Math.exp(drift(i, h) + (rand() - 0.5) * 2 * noise);
      for (let k = 1; k <= 60; k += 1) {
        const t = FROM + h * H + k * M; const p = price * (next / price) ** (k / 60);
        if (!skip(i, t)) ins.run(market, t, p, p, p, p, 1 + rand());
      }
      price = next;
    }
  });
  d.exec("COMMIT");
  return d;
}
// Drift constant within a 36-hour block: the trailing return then predicts the next hour.
const blockDrift = (i, h) => (((Math.floor(h / 36) * 7 + i * 3) % 5) - 2) * 0.004;
const noDrift = () => 0;
const FAST = 400;

test("the span, the family and the constants are the ones in the pre-registration", () => {
  assert.equal(ELIG_START, Date.parse("2026-12-11T00:00:00Z"));
  assert.equal(SCREEN_START, Date.parse("2026-12-18T00:00:00Z"));
  assert.equal(SCREEN_END, Date.parse("2027-01-17T00:00:00Z"));
  assert.equal(EARLIEST_RUN, Date.parse("2027-01-17T00:30:00Z"));
  assert.equal((SCREEN_END - SCREEN_START) / H, 720);
  assert.equal(S.SEED, 20261120); assert.equal(S.B, 10_000); assert.equal(S.K, 6); assert.equal(S.ALPHA, 0.02); assert.equal(S.BLOCK, 24);
  assert.equal(S.MIN_USABLE_HOURS, 600); assert.equal(S.MIN_COMPLETE_BARS, 152);
  assert.deepEqual(S.SIGNALS.map((x) => [x.name, x.s]), [["RET6", -1], ["RET24", 1], ["RET72", 1], ["VOL24", -1], ["SURGE", 1], ["RANGE", 1]]);
  assert.deepEqual([...S.MARKETS], ["KRW-BTC", "KRW-ETH", "KRW-NEAR", "KRW-SOL", "KRW-XRP"]);
  const u = makeRandom(S.SEED);
  assert.deepEqual([u(), u(), u()], [0.33736467085460264, 0.38063347140274995, 0.34159181396718497]);
});

test("Holm step-down: ordering, monotone chain, cap at 1", () => {
  const adj = S.holm([0.01, 0.04, 0.03, 0.005, 1, 1]);
  assert.ok(Math.abs(adj[3] - 0.03) < 1e-12 && Math.abs(adj[0] - 0.05) < 1e-12);
  assert.ok(Math.abs(adj[2] - 0.12) < 1e-12 && Math.abs(adj[1] - 0.12) < 1e-12);
  assert.equal(adj[4], 1); assert.equal(adj[5], 1);
  assert.deepEqual(S.holm([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]), [1, 1, 1, 1, 1, 1]);
});

test("the block sign-flip test rejects a clear positive weighted mean, keeps a centred one, and is deterministic", () => {
  const strong = Array.from({ length: 720 }, (_, i) => 0.2 + ((i * 7) % 11) / 100); const w = strong.map(() => 4);
  assert.ok(S.signFlipP(strong, w, makeRandom(S.SEED), 1000).p < 0.01);
  const centred = Array.from({ length: 720 }, (_, i) => (i % 2 === 0 ? 0.3 : -0.3));
  assert.ok(S.signFlipP(centred, w, makeRandom(S.SEED), 1000).p > 0.2);
  assert.deepEqual(S.signFlipP(strong, w, makeRandom(S.SEED), 200), S.signFlipP(strong, w, makeRandom(S.SEED), 200));
  assert.ok(S.weightedMean([1, 0], [1, 9]) < 0.2);
  // T not a multiple of 24: the last, shorter group is one block with its own flip
  const odd = Array.from({ length: 650 }, (_, i) => 0.1 + (i % 7) / 100);
  assert.ok(S.signFlipP(odd, odd.map(() => 4), makeRandom(S.SEED), 200).p < 0.05);
  assert.equal(S.signFlipP(odd, odd.map(() => 4), makeRandom(S.SEED), 200).p, naiveSignFlipP(odd, odd.map(() => 4), makeRandom(S.SEED), 200), "the 2-hour last block is one block with its own flip");
});

/** Independent naive restatement of the pre-registered pseudocode, reading the same uniform stream. */
function naiveSignFlipP(xs, ws, u, B) {
  const T = xs.length; const blocks = [];
  for (let start = 0; start < T; start += 24) { let s = 0; for (let j = start; j < Math.min(T, start + 24); j += 1) s += ws[j] * xs[j]; blocks.push(s); }
  let W = 0; for (const w of ws) W += w;
  let total = 0; for (const s of blocks) total += s;
  const M = total / W; let ge = 0;
  for (let b = 0; b < B; b += 1) { let sum = 0; for (let k = 0; k < blocks.length; k += 1) { const sign = u() < 0.5 ? -1 : 1; sum += sign * blocks[k]; } if (sum / W >= M - 1e-12) ge += 1; }
  return (1 + ge) / (B + 1);
}
test("the sign-flip test equals an independent restatement of the pseudocode and has a pinned value (draw order, strict u < 0.5, tolerance)", () => {
  const xs = Array.from({ length: 150 }, (_, i) => Math.sin(i / 7) * 0.4 + (i % 5) * 0.02); const ws = xs.map((_, i) => 2 + (i % 3));
  const a = S.signFlipP(xs, ws, makeRandom(S.SEED), 500).p; const b = naiveSignFlipP(xs, ws, makeRandom(S.SEED), 500);
  assert.equal(a, b);
  assert.equal(a, 0.16966067864271456);
  // an all-plus flip reproduces M: with every sum equal to 0 the statistic ties and counts as an exceedance
  assert.equal(S.signFlipP([0, 0, 0], [1, 1, 1], () => 0.9, 10).p, 1);
});

test("Holm with some signals insufficient and others sufficient, and the 4 h / weekly / identity outputs", { timeout: 600_000 }, () => {
  const adj = S.holm([1, 0.001, 1, 0.02, 1, 1]);
  assert.ok(Math.abs(adj[1] - 0.006) < 1e-12 && Math.abs(adj[3] - 0.1) < 1e-12 && adj[0] === 1);
  const db = syntheticDb({ drift: blockDrift, noise: 0.0005 });
  db.prepare("INSERT INTO research_candle_absence VALUES ('KRW-BTC', 60000, ?, ?, 0, 0, 'f', 't', 'c')").run(SCREEN_START + 50 * H - 5 * M, SCREEN_START + 50 * H - 3 * M);
  const r = S.runScreen({ db, now: AFTER, resamples: 50 });
  assert.equal(r.retDayFourHourExcluded, 3, "the last 3 hours have no t + 4 h inside the span");
  assert.equal(r.retDayWeekHoursFour, 48, "block 4 has 2 days");
  assert.equal(r.retDayWeekHoursZero, 168);
  assert.ok(r.datasetFirstMs >= Date.parse("2026-12-10T23:00:00Z") && r.datasetLastMs === SCREEN_END);
  assert.ok("retDayFourHourSkippedHours" in r && "retDayFourHourConstantHours" in r);
});

test("signal formulas, missing-value rules and the absence of look-ahead", () => {
  const t = SCREEN_START + 100 * H;
  const s = { market: "KRW-BTC", close: new Map(), volume: new Map(), absent: new Set(), barCache: new Map() };
  for (let k = 0; k <= 80 * 60; k += 1) { const m = t - k * M; s.close.set(m, 100 + (m - (t - 80 * H)) / H); s.volume.set(m, 1); }
  const hourly = (hh) => s.close.get(t - hh * H);
  assert.ok(Math.abs(S.SIGNAL_FN.retSix(s, t) - (hourly(0) / hourly(6) - 1)) < 1e-15);
  assert.ok(Math.abs(S.SIGNAL_FN.retThreeDays(s, t) - (hourly(0) / hourly(72) - 1)) < 1e-15);
  const lo = hourly(24); const hi = hourly(0);
  assert.ok(Math.abs(S.SIGNAL_FN.rangeDay(s, t) - 1) < 1e-15 && hi > lo);
  const logs = []; for (let k = 24; k >= 1; k -= 1) logs.push(Math.log(hourly(k - 1) / hourly(k)));
  const mean = logs.reduce((a, v) => a + v, 0) / 24; const sd = Math.sqrt(logs.reduce((a, v) => a + (v - mean) ** 2, 0) / 23);
  assert.ok(Math.abs(S.SIGNAL_FN.volDay(s, t) - sd) < 1e-15);
  assert.ok(Math.abs(S.SIGNAL_FN.surge(s, t) - 1) < 1e-12, "constant volume: last hour equals the 24 h hourly mean");
  // SURGE: an absent minute counts as zero, an unknown minute or a null volume makes it missing, a zero 24 h sum makes it missing
  const keep = s.volume.get(t - 5 * M);
  s.volume.delete(t - 5 * M); s.absent.add(t - 5 * M);
  assert.ok(Math.abs(S.SIGNAL_FN.surge(s, t) - 59 / (1439 / 24)) < 1e-12);
  s.absent.delete(t - 5 * M); assert.equal(S.SIGNAL_FN.surge(s, t), undefined);
  s.volume.set(t - 5 * M, null); assert.equal(S.SIGNAL_FN.surge(s, t), undefined);
  s.volume.set(t - 5 * M, keep);
  for (const m of s.volume.keys()) s.volume.set(m, 0); assert.equal(S.SIGNAL_FN.surge(s, t), undefined);
  // a missing hourly close makes VOL24, RANGE and the return missing; no forward fill
  s.close.delete(t - 10 * H); assert.equal(S.SIGNAL_FN.volDay(s, t), undefined); assert.equal(S.SIGNAL_FN.rangeDay(s, t), undefined);
  assert.notEqual(S.SIGNAL_FN.retSix(s, t), undefined);
  // no look-ahead: nothing after t moves any signal at t
  const before = ["retSix", "retDay", "retThreeDays"].map((k) => S.SIGNAL_FN[k](s, t));
  for (let k = 1; k <= 600; k += 1) s.close.set(t + k * M, 1e9);
  assert.deepEqual(["retSix", "retDay", "retThreeDays"].map((k) => S.SIGNAL_FN[k](s, t)), before);
  // RANGE with max = min has no value
  const flat = { market: "KRW-ETH", close: new Map(), volume: new Map(), absent: new Set(), barCache: new Map() };
  for (let k = 0; k <= 30 * 60; k += 1) flat.close.set(t - k * M, 5);
  assert.equal(S.SIGNAL_FN.rangeDay(flat, t), undefined);
});

test("a bar is complete only with 60 present or proven-absent minutes", () => {
  const t = SCREEN_START + H;
  const s = { market: "KRW-BTC", close: new Map(), volume: new Map(), absent: new Set(), barCache: new Map() };
  for (let k = 0; k < 60; k += 1) s.close.set(t - k * M, 1);
  assert.equal(S.barComplete(s, t), true);
  s.close.delete(t - 7 * M); s.barCache.clear(); assert.equal(S.barComplete(s, t), false);
  s.absent.add(t - 7 * M); s.barCache.clear(); assert.equal(S.barComplete(s, t), true);
  s.close.delete(t); s.absent.add(t); s.barCache.clear();
  assert.equal(S.barComplete(s, t), true); assert.equal(S.eligibleAt(s, t), false, "a complete bar whose last minute is absent has no close");
});

test("waits until 2027-01-17T00:30Z and then reads values; counts only before", () => {
  const db = syntheticDb({ drift: noDrift });
  const early = S.runScreen({ db, now: ELIG_START + 3.5 * 24 * H });
  assert.equal(early.status, "WAITING_DATA"); assert.equal(early.daysCollected, 3);
  assert.deepEqual(Object.keys(early).filter((k) => k.endsWith("Minutes")).sort(), ["btcMinutes", "ethMinutes", "nearMinutes", "solMinutes", "xrpMinutes"]);
  for (const v of Object.values(early)) assert.ok(v === "WAITING_DATA" || Number.isSafeInteger(v));
  assert.equal(S.runScreen({ db, now: EARLIEST_RUN - 60_000 }).status, "WAITING_DATA");
});

test("a row stamped after the run time is a data integrity failure", () => {
  const db = syntheticDb({ drift: noDrift });
  db.prepare("INSERT INTO research_closed_candles VALUES ('KRW-BTC', 60000, ?, 1, 1, 1, 1, 'x', 1)").run(AFTER + 120_000);
  assert.deepEqual(S.runScreen({ db, now: AFTER, resamples: FAST }), { status: "DATA_INTEGRITY_FAIL", reasonCode: "DATA_FUTURE" });
});

test("planted 24 h momentum: RET24 and RANGE pass, the reversal RET6, the 72 h return and SURGE do not; deterministic and fixed in shape", { timeout: 600_000 }, () => {
  const db = syntheticDb({ drift: blockDrift, noise: 0.0005 });
  const r = S.runScreen({ db, now: AFTER, resamples: FAST });
  assert.equal(r.status, "SCREEN_PASS", JSON.stringify(r));
  assert.equal(r.eligible, 5); assert.equal(r.k, 6);
  assert.equal(r.retDayPass, true); assert.equal(r.rangeDayPass, true);
  assert.equal(r.retSixPass, false); assert.equal(r.retThreeDaysPass, false, "36 h blocks do not predict from a 72 h lookback"); assert.equal(r.surgePass, false);
  assert.ok(r.retSixMeanIc < 0, "the reversal direction is signed: momentum data gives a negative tested value");
  assert.ok(r.retDayHours >= 700 && r.retDayMeanIc > 0.05);
  assert.match(r.datasetFingerprint, /^[0-9a-f]{64}$/);
  for (const sig of S.SIGNALS) for (const f of ["Hours", "MeanIc", "P", "AdjP", "Pass", "Insufficient", "FourHourMeanIc", "WeekIcZero", "WeekIcFour"]) assert.ok(`${sig.key}${f}` in r, `${sig.key}${f}`);
  assert.deepEqual(S.runScreen({ db, now: AFTER, resamples: FAST }), r);
});

test("pure noise passes nothing", { timeout: 600_000 }, () => {
  const db = syntheticDb({ drift: noDrift, noise: 0.004 });
  const r = S.runScreen({ db, now: AFTER, resamples: FAST });
  assert.equal(r.status, "SCREEN_FAIL", JSON.stringify(r));
  for (const sig of S.SIGNALS) assert.equal(r[`${sig.key}Pass`], false);
});

test("a signal with fewer than 600 usable hours is INSUFFICIENT_DATA for that signal (p = 1, stays in K = 6)", { timeout: 600_000 }, () => {
  const lostFrom = SCREEN_START + 10 * 24 * H; const lostTo = SCREEN_START + 28 * 24 * H;
  const db = syntheticDb({ drift: blockDrift, noise: 0.0005, skip: (i, t) => t > lostFrom && t <= lostTo });
  const r = S.runScreen({ db, now: AFTER, resamples: FAST });
  assert.equal(r.status, "SCREEN_FAIL");
  for (const sig of S.SIGNALS) { assert.equal(r[`${sig.key}Insufficient`], true); assert.equal(r[`${sig.key}P`], 1); assert.equal(r[`${sig.key}Pass`], false); }
});

test("fewer than 3 eligible markets (152 of 168 complete bars) is INSUFFICIENT_DATA", { timeout: 600_000 }, () => {
  const db = syntheticDb({ drift: blockDrift, skip: (i, t) => i < 3 && t > ELIG_START && t <= SCREEN_START && Math.floor((t - ELIG_START) / H) % 4 === 0 });
  const r = S.runScreen({ db, now: AFTER, resamples: FAST });
  assert.equal(r.status, "INSUFFICIENT_DATA"); assert.equal(r.eligible, 2);
});

test("the 152 of 168 bar is exact", { timeout: 600_000 }, () => {
  const lose = (n) => (i, t) => i === 0 && t % H === 0 && t > ELIG_START && (t - ELIG_START) / H <= n;
  // dropping the closing minute of the first n hours makes those bars incomplete
  assert.equal(S.runScreen({ db: syntheticDb({ drift: noDrift, skip: lose(16) }), now: AFTER, resamples: 50 }).eligible, 5, "152 complete bars is enough");
  assert.equal(S.runScreen({ db: syntheticDb({ drift: noDrift, skip: lose(17) }), now: AFTER, resamples: 50 }).eligible, 4, "151 is not");
});

test("fails closed without a state path", () => {
  const r = spawnSync(process.execPath, [require.resolve("./run-signal-screen.js")], { env: { ...process.env, NUSA_CLOUD_STATE_DB_PATH: "" }, encoding: "utf8" });
  assert.equal(r.status, 1); assert.match(r.stderr, /SIGNAL_SCREEN_STUDY_FAILED_CLOSED/);
});
