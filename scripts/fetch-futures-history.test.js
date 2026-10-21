"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { fetchHistory, verify, HistoryError, SYMBOLS, START, END, BAR_MS } = require("./fetch-futures-history.js");

function fakeFetch({ breakAt, status, dropFunding } = {}) {
  let n = 0;
  return async (url) => {
    n += 1;
    if (status) return { ok: false, status, json: async () => ({}) };
    const u = new URL(url); const symbol = u.searchParams.get("symbol");
    const from = Number(u.searchParams.get("startTime"));
    if (u.pathname.endsWith("klines")) {
      const rows = [];
      for (let t = from; t < END && rows.length < 1500; t += BAR_MS) {
        const o = 100 + ((t / BAR_MS) % 50);
        rows.push([breakAt && t === breakAt ? t + BAR_MS : t, String(o), String(o + 2), String(o - 2), String(o + 1), "10", t + BAR_MS - 1]);
      }
      return { ok: true, json: async () => rows };
    }
    const rows = [];
    for (let t = from - (from % (8 * 3_600_000)) + 8 * 3_600_000; t < END && rows.length < 1000; t += 8 * 3_600_000) if (t >= from) rows.push({ symbol, fundingTime: t, fundingRate: "0.0001" });
    return { ok: true, json: async () => (dropFunding ? [] : rows) };
  };
}
const noSleep = async () => {};

test("fetches all five symbols, contiguous 4h bars, ordered funding; manifest hashes are deterministic", async () => {
  const a = await fetchHistory({ fetchImpl: fakeFetch(), sleep: noSleep });
  const b = await fetchHistory({ fetchImpl: fakeFetch(), sleep: noSleep });
  assert.equal(Object.keys(a.files).length, 10);
  for (const s of SYMBOLS) assert.equal(a.manifest.files[`klines_${s}_4h.csv`].rows, (END - START) / BAR_MS);
  assert.deepEqual(a.manifest.files, b.manifest.files);
  assert.equal(verify(a, b.manifest).ok, true);
  const tampered = JSON.parse(JSON.stringify(b.manifest)); tampered.files["klines_BTCUSDT_4h.csv"].sha256 = "0".repeat(64);
  assert.equal(verify(a, tampered).ok, false, "a hash mismatch refuses the data");
});

test("fails closed on a gap, on a region block (never retried), and on missing funding", async () => {
  await assert.rejects(fetchHistory({ fetchImpl: fakeFetch({ breakAt: START + 10 * BAR_MS }), sleep: noSleep }), (e) => e instanceof HistoryError && e.code === "KLINE_GAP_OR_UNALIGNED");
  let calls = 0; const blocked = fakeFetch({ status: 451 });
  await assert.rejects(fetchHistory({ fetchImpl: async (u, o) => { calls += 1; return blocked(u, o); }, sleep: noSleep }), (e) => e.code === "HTTP_451");
  assert.equal(calls, 1, "451 is final: no retry and no workaround");
  await assert.rejects(fetchHistory({ fetchImpl: fakeFetch({ dropFunding: true }), sleep: noSleep }), (e) => e.code === "FUNDING_TOO_SHORT");
});

test("verify is key-order independent and refuses another range, symbol list or a bare manifest", async () => {
  const a = await fetchHistory({ fetchImpl: fakeFetch(), sleep: noSleep });
  const reordered = { ...a.manifest, files: Object.fromEntries(Object.entries(a.manifest.files).reverse()) };
  assert.equal(verify(a, reordered).ok, true);
  assert.equal(verify(a, { ...a.manifest, endMs: a.manifest.endMs - 1 }).ok, false);
  assert.equal(verify(a, { ...a.manifest, symbols: ["BTCUSDT"] }).ok, false);
  assert.equal(verify({ files: a.files }, a.manifest).ok, false);
});

test("429 and 5xx are retried, then fail closed", async () => {
  let calls = 0;
  await assert.rejects(fetchHistory({ fetchImpl: async () => { calls += 1; return { ok: false, status: 503, json: async () => ({}) }; }, sleep: noSleep }), (e) => e.code === "HTTP_RETRY_EXHAUSTED");
  assert.equal(calls, 4);
});
