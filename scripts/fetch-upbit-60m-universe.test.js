"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const u = require("./fetch-upbit-60m-universe.js");

const HOUR = 3_600_000;
const NOW = Date.parse("2026-11-24T12:00:00Z");
const noSleep = async () => {};
const iso = (ms) => new Date(ms).toISOString().slice(0, 19);

/** Synthetic made-up series only. `spec[market]` = { first: ms of first candle, holeEvery, none }. */
function fake(spec = {}, opts = {}) {
  let calls = 0; const seen = [];
  const fn = async (url) => {
    calls += 1; seen.push(url);
    if (opts.status && calls >= (opts.statusFrom || 1)) return { ok: false, status: opts.status, headers: { get: () => null }, json: async () => ({}) };
    if (opts.rate429 && calls <= opts.rate429) return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({}) };
    const parsed = new URL(url); const market = parsed.searchParams.get("market"); const to = Date.parse(parsed.searchParams.get("to"));
    const s = spec[market] || {}; const first = s.first60 ?? s.first ?? Date.parse("2021-01-01T00:00:00Z");
    const rows = [];
    if (parsed.pathname.includes("/candles/days")) {
      const firstDaily = Math.floor((s.first ?? Date.parse("2021-01-01T00:00:00Z")) / (24 * HOUR)) * 24 * HOUR;
      for (let t = Math.floor((to - 1) / (24 * HOUR)) * 24 * HOUR; rows.length < 200 && t >= firstDaily; t -= 24 * HOUR) rows.push({ market, candle_date_time_utc: iso(t), opening_price: 1, high_price: 1, low_price: 1, trade_price: 1, candle_acc_trade_volume: 1, candle_acc_trade_price: 1 });
      return { ok: true, headers: { get: () => null }, json: async () => rows };
    }
    for (let t = to - HOUR; rows.length < 200 && t >= first && !s.none; t -= HOUR) {
      if (s.holeEvery && (t / HOUR) % s.holeEvery === 0) continue;
      const o = 100 + ((t / HOUR) % 50);
      rows.push({ market: opts.badMarket ? "KRW-OTHER" : market, candle_date_time_utc: iso(t), opening_price: o, high_price: o + 2, low_price: o - 2, trade_price: o + 1, candle_acc_trade_volume: 5, candle_acc_trade_price: 1000 + (t / HOUR) % 7 });
    }
    return { ok: true, headers: { get: (k) => (opts.remaining && k === "remaining-req" ? opts.remaining : null) }, json: async () => rows };
  };
  fn.calls = () => calls; fn.seen = seen;
  return fn;
}
const run = (markets, spec, opts, extra = {}) => u.fetchGroup({ group: "g1", markets, fetchImpl: fake(spec, opts), sleep: noSleep, now: () => NOW, ...extra });

test("hold-back files exist only for markets outside BTC, ETH, SOL, NEAR, XRP; quote value is the 7th column; manifests are deterministic", async () => {
  const a = await run(["KRW-BTC", "KRW-ADA"]); const b = await run(["KRW-BTC", "KRW-ADA"]);
  assert.deepEqual(Object.keys(a.manifest.files), ["KRW-ADA_discovery_60m.csv", "KRW-ADA_holdback_60m.csv", "KRW-BTC_discovery_60m.csv"]);
  assert.ok(a.files["KRW-ADA_discovery_60m.csv"].startsWith("startMs,open,high,low,close,volume,quoteValue\n"));
  assert.equal(a.files["KRW-ADA_discovery_60m.csv"].split("\n")[1].split(",").length, 7);
  assert.equal(u.verify(a, b.manifest).ok, true);
  const tampered = JSON.parse(JSON.stringify(b.manifest)); tampered.files["KRW-BTC_discovery_60m.csv"].sha256 = "0".repeat(64);
  assert.equal(u.verify(a, tampered).ok, false);
  assert.equal(a.manifest.files["KRW-BTC_discovery_60m.csv"].rows, (u.WINDOWS.discovery.to - u.WINDOWS.discovery.from) / HOUR);
});

test("a market with no data, too many holes or a too short window is excluded with a reason; the others stay", async () => {
  const spec = { "KRW-NONE": { first: Date.parse("2024-01-01T00:00:00Z") }, "KRW-HOLES": { holeEvery: 4 }, "KRW-LATE": { first: Date.parse("2023-06-25T00:00:00Z") } };
  const r = await run(["KRW-ADA", "KRW-NONE", "KRW-HOLES", "KRW-LATE"], spec);
  const reasons = Object.fromEntries(r.manifest.excluded.filter((e) => e.window === "discovery").map((e) => [e.market, e.reason]));
  assert.equal(reasons["KRW-NONE"], "WINDOW_EMPTY"); // listed after the discovery window: genuinely absent there
  assert.equal(reasons["KRW-HOLES"], "MISSING_SHARE_TOO_HIGH");
  assert.equal(reasons["KRW-LATE"], "WINDOW_TOO_SHORT");
  assert.ok(r.manifest.files["KRW-ADA_discovery_60m.csv"]);
});

test("a market listed inside the window is kept (the miner applies the 30 day listing wait)", async () => {
  const r = await run(["KRW-NEW"], { "KRW-NEW": { first: Date.parse("2022-09-01T00:00:00Z") } });
  const f = r.manifest.files["KRW-NEW_discovery_60m.csv"];
  assert.ok(f && f.firstStartMs === Date.parse("2022-09-01T00:00:00Z") && f.missingHours === 0);
});

test("HTTP 451, a foreign market row and invalid input abort the group", async () => {
  await assert.rejects(run(["KRW-ADA"], {}, { status: 451 }), { code: "HTTP_451" });
  await assert.rejects(run(["KRW-ADA"], {}, { badMarket: true }), { code: "CANDLE_ROW_MALFORMED" });
  await assert.rejects(u.fetchGroup({ group: "Bad Name", markets: ["KRW-ADA"], fetchImpl: fake(), sleep: noSleep, now: () => NOW }), { code: "GROUP_NAME_INVALID" });
  for (const markets of [[], ["BTC-KRW"], ["KRW-ADA", "KRW-ADA"], ["KRW-ada"], Array.from({ length: 61 }, (_, i) => `KRW-M${i}`)]) await assert.rejects(u.fetchGroup({ group: "g", markets, fetchImpl: fake(), sleep: noSleep, now: () => NOW }), { code: "MARKET_LIST_INVALID" });
});

test("three consecutive HTTP 429 stop the group; fewer are retried", async () => {
  await assert.rejects(run(["KRW-ADA"], {}, { rate429: 3 }), { code: "RATE_LIMITED_STOP" });
  const ok = await run(["KRW-BTC"], {}, { rate429: 2 });
  assert.ok(ok.manifest.files["KRW-BTC_discovery_60m.csv"]);
});

test("an unclosed window and an exhausted remaining-request budget (sec=0) are handled", async () => {
  await assert.rejects(u.fetchGroup({ group: "g", markets: ["KRW-BTC"], fetchImpl: fake(), sleep: noSleep, now: () => Date.parse("2023-01-01T00:00:00Z") }), { code: "WINDOW_NOT_CLOSED" });
  const sleeps = [];
  await u.fetchGroup({ group: "g", markets: ["KRW-BTC"], fetchImpl: fake({}, { remaining: "group=candles; min=600; sec=0" }), sleep: async (ms) => { sleeps.push(ms); }, now: () => NOW });
  assert.ok(sleeps.includes(1000), "sleeps a full second when the per-second budget is 0");
});

test("write needs an empty output outside the repository and free disk; a group is written whole with its manifest", async () => {
  assert.throws(() => u.write(path.join(__dirname, "..", "x"), { files: {}, manifest: { group: "g" } }), { code: "OUT_DIR_MUST_BE_OUTSIDE_THE_REPOSITORY" });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "universe-"));
  try {
    const r = await run(["KRW-BTC"]);
    u.write(path.join(dir, "out"), r);
    assert.ok(fs.existsSync(path.join(dir, "out", "KRW-BTC_discovery_60m.csv")) && fs.existsSync(path.join(dir, "out", "manifest.g1.json")));
    assert.throws(() => u.write(path.join(dir, "out"), r), { code: "OUT_DIR_NOT_EMPTY" });
    assert.throws(() => u.assertDiskHeadroom(dir, Number.MAX_SAFE_INTEGER / 4), { code: "DISK_HEADROOM_TOO_LOW" });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a truncated or empty history of a market listed in time aborts the group instead of being excluded or treated as a late listing", async () => {
  // daily history starts in 2021 but the 60m history only in 2023-03: truncated
  await assert.rejects(run(["KRW-ADA"], { "KRW-ADA": { first: Date.parse("2021-01-01T00:00:00Z"), first60: Date.parse("2023-03-01T00:00:00Z") } }), { code: "HISTORY_TRUNCATED" });
  // listed inside the window, but the 60m history starts months after its first daily candle: truncated
  await assert.rejects(run(["KRW-ADA"], { "KRW-ADA": { first: Date.parse("2022-03-01T00:00:00Z"), first60: Date.parse("2022-06-01T00:00:00Z") } }), { code: "HISTORY_TRUNCATED" });
  // listed in time but no 60m data at all
  await assert.rejects(run(["KRW-ADA"], { "KRW-ADA": { first: Date.parse("2021-01-01T00:00:00Z"), none: true } }), { code: "HISTORY_TRUNCATED" });
});

test("hold-back files: none for BTC, ETH, SOL, NEAR, XRP; DOGE and others get one; windows equal the committed fetch script's", async () => {
  for (const m of ["KRW-BTC", "KRW-ETH", "KRW-SOL", "KRW-NEAR", "KRW-XRP"]) assert.deepEqual(u.windowsFor(m), ["discovery"]);
  for (const m of ["KRW-DOGE", "KRW-ADA"]) assert.deepEqual(u.windowsFor(m), ["discovery", "holdback"]);
  assert.equal(u.WINDOWS, require("./fetch-upbit-60m-history.js").WINDOWS);
  const r = await run(["KRW-DOGE"]);
  assert.equal(r.manifest.files["KRW-DOGE_holdback_60m.csv"].rows, (u.WINDOWS.holdback.to - u.WINDOWS.holdback.from) / HOUR);
});

test("data corruption never excludes: invalid values, a zero quote value with volume, malformed numbers abort", async () => {
  const corrupt = (mut) => async (url, init) => { const res = await fake()(url, init); if (new URL(url).pathname.includes("/candles/days")) return res; const rows = await res.json(); mut(rows); return { ...res, json: async () => rows }; };
  await assert.rejects(u.fetchGroup({ group: "g", markets: ["KRW-ADA"], fetchImpl: corrupt((rows) => { rows[3].trade_price = -1; }), sleep: noSleep, now: () => NOW }), { code: "CANDLE_VALUES_INVALID" });
  await assert.rejects(u.fetchGroup({ group: "g", markets: ["KRW-ADA"], fetchImpl: corrupt((rows) => { rows[3].candle_acc_trade_price = 0; }), sleep: noSleep, now: () => NOW }), { code: "CANDLE_VALUES_INVALID" });
  await assert.rejects(u.fetchGroup({ group: "g", markets: ["KRW-ADA"], fetchImpl: corrupt((rows) => { rows[3].opening_price = "5\n"; }), sleep: noSleep, now: () => NOW }), { code: "CANDLE_VALUES_INVALID" });
  await assert.rejects(u.fetchGroup({ group: "g", markets: ["KRW-ADA"], fetchImpl: corrupt((rows) => { rows[2] = rows[1]; }), sleep: noSleep, now: () => NOW }), { code: "CANDLE_DISORDER_OR_DUPLICATE" });
});

test("429 counter resets after any other outcome; sec=29 does not sleep; 5xx is retried; HTTP 418 aborts", async () => {
  let n = 0; const flaky = (statusFor) => async (url, init) => { n += 1; const st = statusFor(n); if (st) return { ok: false, status: st, headers: { get: () => null }, json: async () => ({}) }; return fake()(url, init); };
  n = 0; const ok = await u.fetchGroup({ group: "g", markets: ["KRW-BTC"], fetchImpl: flaky((k) => (k === 1 || k === 3 ? 429 : k === 2 ? 500 : 0)), sleep: noSleep, now: () => NOW });
  assert.ok(ok.manifest.files["KRW-BTC_discovery_60m.csv"], "429, 500, 429 is not three in a row, and the call then succeeds");
  n = 0; await assert.rejects(u.fetchGroup({ group: "g", markets: ["KRW-BTC"], fetchImpl: flaky((k) => (k === 1 ? 418 : 0)), sleep: noSleep, now: () => NOW }), { code: "HTTP_418" });
  const sleeps = []; await u.fetchGroup({ group: "g", markets: ["KRW-BTC"], fetchImpl: fake({}, { remaining: "group=candles; min=600; sec=29" }), sleep: async (ms) => { sleeps.push(ms); }, now: () => NOW });
  assert.ok(!sleeps.includes(1000));
});

test("verify compares files, windows, markets, listing days and exclusions (order-insensitive)", async () => {
  const a = await run(["KRW-ADA", "KRW-BTC"], { "KRW-HOLES": { holeEvery: 4 } }); const clone = () => JSON.parse(JSON.stringify(a.manifest));
  assert.equal(u.verify(a, clone()).ok, true);
  const w = clone(); w.windows.discovery.from += 1; assert.equal(u.verify(a, w).ok, false);
  const mk = clone(); mk.markets = ["KRW-BTC", "KRW-ADA", "KRW-ETH"]; assert.equal(u.verify(a, mk).ok, false);
  const l = clone(); l.listingFirstDailyMs["KRW-ADA"] += 86400000; assert.equal(u.verify(a, l).ok, false);
  const b = await run(["KRW-HOLES", "KRW-ADA"], { "KRW-HOLES": { holeEvery: 4 } }); const c = await run(["KRW-ADA", "KRW-HOLES"], { "KRW-HOLES": { holeEvery: 4 } });
  assert.equal(u.verify(b, JSON.parse(JSON.stringify(c.manifest))).ok, true, "the same markets in a different order compare equal");
});

test("an output directory is checked before the fetch (not empty, free disk floor); write rejects an invalid group name", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "universe-pre-"));
  try {
    u.assertOutputReady(path.join(dir, "ok"), 1024);
    fs.writeFileSync(path.join(dir, "old"), "x");
    assert.throws(() => u.assertOutputReady(dir, 1024), { code: "OUT_DIR_NOT_EMPTY" });
    assert.throws(() => u.assertOutputReady(path.join(dir, "new"), Number.MAX_SAFE_INTEGER / 4), { code: "DISK_HEADROOM_TOO_LOW" });
    assert.throws(() => u.write(path.join(dir, "w"), { files: {}, manifest: { group: "../x" } }), { code: "GROUP_NAME_INVALID" });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
