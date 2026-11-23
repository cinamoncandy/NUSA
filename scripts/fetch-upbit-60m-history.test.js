"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { fetchHistory, verify, write, assertOutsideRepository, toStoreRows, buildStore, HistoryError, WINDOWS, MARKETS, HOUR_MS } = require("./fetch-upbit-60m-history.js");

const NOW = Date.parse("2026-11-23T00:00:00Z");
const noSleep = async () => {};
const iso = (ms) => new Date(ms).toISOString().slice(0, 19);

/** Synthetic series only: values are made up and carry no market information. */
function fakeFetch({ holeEvery, status, dup, bad, lateStart, flaky } = {}) {
  let calls = 0;
  return async (url) => {
    calls += 1;
    if (flaky && calls <= 2) throw new Error("ECONNRESET");
    if (status) return { ok: false, status, json: async () => ({}) };
    const u = new URL(url); const market = u.searchParams.get("market");
    const to = Date.parse(u.searchParams.get("to"));
    const rows = [];
    for (let t = to - HOUR_MS; rows.length < 200 && t > Date.parse("2021-01-01T00:00:00Z"); t -= HOUR_MS) {
      if (holeEvery && (t / HOUR_MS) % holeEvery === 0) continue;
      if (lateStart && t < Date.parse("2022-03-01T00:00:00Z")) continue;
      const o = 100 + ((t / HOUR_MS) % 50);
      rows.push({ market, candle_date_time_utc: iso(t), opening_price: o, high_price: o + 2, low_price: o - 2, trade_price: bad ? -1 : o + 1, candle_acc_trade_volume: 5 });
    }
    if (dup && rows.length > 2) rows[1] = rows[0];
    return { ok: true, json: async () => rows };
  };
}

test("fetches every pre-registered market and window; XRP has no hold-back; manifests are deterministic", async () => {
  const a = await fetchHistory({ fetchImpl: fakeFetch(), sleep: noSleep, now: () => NOW });
  const b = await fetchHistory({ fetchImpl: fakeFetch(), sleep: noSleep, now: () => NOW });
  const expectedFiles = Object.entries(MARKETS).flatMap(([m, w]) => w.map((n) => `${m}_${n}_60m.csv`)).sort();
  assert.deepEqual(Object.keys(a.manifest.files), expectedFiles);
  assert.equal(Object.keys(a.files).some((n) => n.startsWith("KRW-XRP_holdback")), false);
  const d = a.manifest.files["KRW-BTC_discovery_60m.csv"];
  assert.equal(d.rows, (WINDOWS.discovery.to - WINDOWS.discovery.from) / HOUR_MS);
  assert.equal(d.missingHours, 0);
  assert.equal(verify(a, b.manifest).ok, true);
  const tampered = JSON.parse(JSON.stringify(b.manifest)); tampered.files["KRW-BTC_discovery_60m.csv"].sha256 = "0".repeat(64);
  assert.equal(verify(a, tampered).ok, false);
});

test("holes are stored absent and counted; too many holes abort", async () => {
  const ok = await fetchHistory({ fetchImpl: fakeFetch({ holeEvery: 40 }), sleep: noSleep, now: () => NOW });
  const f = ok.manifest.files["KRW-ETH_discovery_60m.csv"];
  assert.ok(f.missingHours > 0 && f.missingShare < 0.10);
  assert.equal(f.rows + f.missingHours, f.listedHours);
  await assert.rejects(fetchHistory({ fetchImpl: fakeFetch({ holeEvery: 5 }), sleep: noSleep, now: () => NOW }), { code: "MISSING_SHARE_TOO_HIGH" });
});

test("fails closed: HTTP block is final, duplicate, invalid values, unclosed window", async () => {
  await assert.rejects(fetchHistory({ fetchImpl: fakeFetch({ status: 451 }), sleep: noSleep, now: () => NOW }), { code: "HTTP_451" });
  await assert.rejects(fetchHistory({ fetchImpl: fakeFetch({ dup: true }), sleep: noSleep, now: () => NOW }), { code: "CANDLE_DISORDER_OR_DUPLICATE" });
  await assert.rejects(fetchHistory({ fetchImpl: fakeFetch({ bad: true }), sleep: noSleep, now: () => NOW }), { code: "CANDLE_VALUES_INVALID" });
  await assert.rejects(fetchHistory({ fetchImpl: fakeFetch(), sleep: noSleep, now: () => Date.parse("2024-01-01T00:00:00Z") }), HistoryError);
});

test("maps a 60m candle starting at s to the hourly close row at s + 1 h (interval 60000) and builds a store", async () => {
  const csv = "startMs,open,high,low,close,volume\n3600000,10,12,9,11,5\n10800000,11,13,10,12,7\n";
  const rows = toStoreRows("KRW-BTC", csv);
  assert.deepEqual(rows.map((r) => [r.intervalMs, r.closeTimeMs, r.close]), [[60000, 7200000, 11], [60000, 14400000, 12]]);
  assert.ok(rows.every((r) => /^[0-9a-f]{64}$/.test(r.checksum)));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "upbit60-"));
  try {
    const dbPath = path.join(dir, "store.sqlite");
    buildStore(dbPath, { "KRW-BTC_discovery_60m.csv": csv });
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(dbPath);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM research_closed_candles WHERE interval_ms = 60000").get().n, 2);
    db.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("exit tail: windows reach 24 h past the design window ends", () => {
  assert.ok(WINDOWS.holdback.to >= Date.parse("2024-11-01T23:00:00Z"));
  assert.ok(WINDOWS.discovery.to >= Date.parse("2023-07-01T23:00:00Z") && WINDOWS.discovery.to < WINDOWS.holdback.from);
});

test("a market whose first candle is far after the window start aborts; network errors are retried", async () => {
  await assert.rejects(fetchHistory({ fetchImpl: fakeFetch({ lateStart: true }), sleep: noSleep, now: () => NOW }), { code: "FIRST_CANDLE_TOO_LATE_IN_WINDOW" });
  const ok = await fetchHistory({ fetchImpl: fakeFetch({ flaky: true }), sleep: noSleep, now: () => NOW });
  assert.ok(ok.manifest.files["KRW-BTC_discovery_60m.csv"].rows > 0);
});

test("output directory must be outside the repository and empty", () => {
  assert.throws(() => assertOutsideRepository(path.join(__dirname, "..", "x")), { code: "OUT_DIR_MUST_BE_OUTSIDE_THE_REPOSITORY" });
  assert.throws(() => assertOutsideRepository(__dirname), { code: "OUT_DIR_MUST_BE_OUTSIDE_THE_REPOSITORY" });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "upbit60w-"));
  try {
    fs.writeFileSync(path.join(dir, "old"), "x");
    assert.throws(() => write(dir, { files: {}, manifest: {} }), { code: "OUT_DIR_NOT_EMPTY" });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
