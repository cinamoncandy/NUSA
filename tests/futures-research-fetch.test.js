const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SYMBOLS, START_MS, END_MS, publicUrl, fetchKlines, fetchFunding, summarizeKlines, run } = require("../scripts/futures-research-fetch.js");

const BAR = 4 * 3600 * 1000;
const kline = (t) => [t, "1", "2", "0.5", "1.5", "10", t + BAR - 1, "0", 0, "0", "0", "0"];

test("the range and symbols are the pre-registered constants", () => {
  assert.deepEqual([...SYMBOLS], ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT"]);
  assert.equal(new Date(START_MS).toISOString(), "2023-01-01T00:00:00.000Z");
  assert.equal(new Date(END_MS).toISOString(), "2026-10-14T00:00:00.000Z");
});

test("only the two public market-data paths can be requested", () => {
  assert.match(publicUrl("/fapi/v1/klines", { symbol: "BTCUSDT" }), /^https:\/\/fapi\.binance\.com\/fapi\/v1\/klines\?symbol=BTCUSDT$/);
  for (const bad of ["/fapi/v1/order", "/fapi/v2/account", "/fapi/v1/listenKey", "/fapi/v1/leverage"]) assert.throws(() => publicUrl(bad, {}), /PATH_NOT_ALLOWED/);
});

test("kline pagination walks forward without overlap and stops at the end", async () => {
  const start = START_MS;
  const end = start + 10 * BAR;
  const urls = [];
  const getJson = async (url) => {
    urls.push(url);
    const from = Number(new URL(url).searchParams.get("startTime"));
    const page = [];
    for (let t = from; t < end && page.length < 4; t += BAR) page.push(kline(t));
    return page;
  };
  const rows = await fetchKlines(getJson, "BTCUSDT", start, end);
  assert.equal(rows.length, 10);
  assert.deepEqual(rows.map((r) => r[0]), Array.from({ length: 10 }, (_, i) => start + i * BAR));
  assert.ok(urls.length <= 4);
});

test("funding pagination advances past the last row and keeps rate and mark price", async () => {
  const start = START_MS;
  const end = start + 6 * 8 * 3600 * 1000;
  const getJson = async (url) => {
    const from = Number(new URL(url).searchParams.get("startTime"));
    const page = [];
    for (let t = start; t < end && page.length < 2; t += 8 * 3600 * 1000) if (t >= from) page.push({ symbol: "BTCUSDT", fundingTime: t, fundingRate: "0.0001", markPrice: "50000" });
    return page;
  };
  const rows = await fetchFunding(getJson, "BTCUSDT", start, end);
  assert.equal(rows.length, 6);
  assert.deepEqual(rows[0], [start, 0.0001, 50000]);
});

test("gaps are counted, never filled, and duplicates are removed", () => {
  const rows = [[0, 1, 1, 1, 1, 1], [BAR, 1, 1, 1, 1, 1], [BAR, 1, 1, 1, 1, 1], [4 * BAR, 1, 1, 1, 1, 1]];
  const summary = summarizeKlines(rows);
  assert.equal(summary.rows.length, 3);
  assert.equal(summary.missingBars, 2);
});

test("a malformed page fails instead of writing partial data", async () => {
  await assert.rejects(fetchKlines(async () => ({ code: -1121 }), "BTCUSDT", START_MS, START_MS + BAR), /BAD_PAGE/);
  await assert.rejects(fetchKlines(async () => [[START_MS, "x", "1", "1", "1", "1"]], "BTCUSDT", START_MS, START_MS + BAR), /BAD_ROW/);
});

test("run writes one file per symbol and kind plus a SHA-256 manifest", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "futures-fetch-"));
  const getJson = async (url) => (new URL(url).pathname.endsWith("klines") ? [kline(START_MS)] : [{ fundingTime: START_MS, fundingRate: "0.0001", markPrice: "1" }]);
  const manifest = await run(dir, getJson, 0);
  assert.equal(Object.keys(manifest.files).length, 10);
  const btc = fs.readFileSync(path.join(dir, "BTCUSDT-4h.json"), "utf8");
  assert.equal(manifest.files["BTCUSDT-4h.json"].sha256, require("node:crypto").createHash("sha256").update(btc).digest("hex"));
  assert.ok(fs.existsSync(path.join(dir, "manifest.json")));
});

test("the fetch script sends no header, key or signature", () => {
  const source = fs.readFileSync(path.join(__dirname, "../scripts/futures-research-fetch.js"), "utf8");
  assert.doesNotMatch(source, /headers\s*:|X-MBX-APIKEY|signature|apiKey|secret|process\.env/i);
});
