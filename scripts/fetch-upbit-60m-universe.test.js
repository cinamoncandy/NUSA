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
    const s = spec[market] || {}; const first = s.first ?? Date.parse("2021-01-01T00:00:00Z");
    const rows = [];
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
  const spec = { "KRW-NONE": { none: true }, "KRW-HOLES": { holeEvery: 4 }, "KRW-LATE": { first: Date.parse("2023-06-25T00:00:00Z") } };
  const r = await run(["KRW-ADA", "KRW-NONE", "KRW-HOLES", "KRW-LATE"], spec);
  const reasons = Object.fromEntries(r.manifest.excluded.filter((e) => e.window === "discovery").map((e) => [e.market, e.reason]));
  assert.equal(reasons["KRW-NONE"], "WINDOW_EMPTY");
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
