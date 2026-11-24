"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const store = require("../scripts/build-broad-store.js");

const H = 3_600_000;
const HEADER = "startMs,open,high,low,close,volume,quoteValue\n";
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
const csv = (start, n) => HEADER + Array.from({ length: n }, (_, i) => `${start + i * H},100,101,99,${100 + i},5,500`).join("\n") + "\n";

/** A synthetic group directory the way the fetch script writes it. */
function makeGroup(root, group, markets, { holdback = true, tamper = false, extra = false, exclude = false } = {}) {
  const dir = path.join(root, group); fs.mkdirSync(dir, { recursive: true });
  const files = {}; const manifestFiles = {};
  for (const m of markets) {
    for (const w of holdback ? ["discovery", "holdback"] : ["discovery"]) {
      const name = `${m}_${w}_60m.csv`; const text = csv(w === "discovery" ? Date.UTC(2022, 0, 1) : Date.UTC(2023, 8, 1), 5);
      files[name] = text; manifestFiles[name] = { sha256: sha(text), rows: 5 };
    }
  }
  for (const [n, t] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), tamper && n === Object.keys(files)[0] ? t.replace("100,101", "100,102") : t);
  if (extra) fs.writeFileSync(path.join(dir, "KRW-ZZZ_discovery_60m.csv"), csv(Date.UTC(2022, 0, 1), 2));
  const manifest = { schemaVersion: 1, source: "upbit-public-60m-universe", group, windows: {}, markets, excluded: exclude ? [{ market: markets[0], window: "holdback", reason: "WINDOW_EMPTY" }] : [],
    listingFirstDailyMs: Object.fromEntries(markets.map((m) => [m, Date.UTC(2021, 0, 1)])), files: manifestFiles };
  fs.writeFileSync(path.join(dir, `manifest.${group}.json`), JSON.stringify(manifest, null, 2) + "\n");
  return { dir, hash: store.manifestHash(manifest) };
}
const tierTable = [{ tick: 1, lowestCurrentPrice: 100, highestCurrentPrice: 200 }];
const pool = (markets) => ({ discoveryPool: markets, tierTable });

test("a valid pair of groups builds the store with discovery candles only, the sorted market list, the merged listing map and the tier table", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bbs-"));
  const g1 = makeGroup(root, "g1", ["KRW-B", "KRW-A"]); const g2 = makeGroup(root, "g2", ["KRW-C"], { holdback: false });
  const out = path.join(root, "out");
  const r = store.build({ groupDirs: { g1: g1.dir, g2: g2.dir }, committed: { g1: g1.hash, g2: g2.hash }, pool: pool(["KRW-C", "KRW-A", "KRW-B"]), outDir: out });
  assert.deepEqual(r, { markets: 3, discoveryFiles: 3 });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, "markets.json"), "utf8")), ["KRW-A", "KRW-B", "KRW-C"]);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(out, "listing.json"), "utf8"))), ["KRW-A", "KRW-B", "KRW-C"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, "tiers.json"), "utf8")), tierTable);
  const db = new DatabaseSync(path.join(out, "store.sqlite"), { readOnly: true });
  const rows = db.prepare("SELECT market, interval_ms, MIN(close_time_ms) AS lo, MAX(close_time_ms) AS hi, COUNT(*) AS n FROM research_closed_candles GROUP BY market ORDER BY market").all();
  db.close();
  assert.equal(rows.length, 3);
  for (const x of rows) { assert.equal(Number(x.interval_ms), 60000); assert.equal(Number(x.n), 5); assert.ok(Number(x.hi) < Date.UTC(2023, 0, 1), "no hold-back candle in the store"); assert.equal(Number(x.lo), Date.UTC(2022, 0, 1) + H); }
  fs.rmSync(root, { recursive: true, force: true });
});

function expectBuildError(setup, pattern) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bbs-"));
  try {
    const { g1, g2, committed, poolMarkets } = setup(root);
    assert.throws(() => store.build({ groupDirs: { g1: g1.dir, g2: g2.dir }, committed: committed || { g1: g1.hash, g2: g2.hash }, pool: pool(poolMarkets), outDir: path.join(root, "out") }), pattern);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test("every difference from the committed manifests fails closed", () => {
  expectBuildError((root) => ({ g1: makeGroup(root, "g1", ["KRW-A"]), g2: makeGroup(root, "g2", ["KRW-B"]), committed: { g1: "0".repeat(64), g2: "1".repeat(64) }, poolMarkets: ["KRW-A", "KRW-B"] }), /differs from the committed one/);
  expectBuildError((root) => ({ g1: makeGroup(root, "g1", ["KRW-A"]), g2: makeGroup(root, "g2", ["KRW-B"]), committed: { g1: "x" }, poolMarkets: ["KRW-A", "KRW-B"] }), /no committed manifest hash/);
  expectBuildError((root) => ({ g1: makeGroup(root, "g1", ["KRW-A"], { tamper: true }), g2: makeGroup(root, "g2", ["KRW-B"]), poolMarkets: ["KRW-A", "KRW-B"] }), /differs from its manifest hash/);
  expectBuildError((root) => ({ g1: makeGroup(root, "g1", ["KRW-A"], { extra: true }), g2: makeGroup(root, "g2", ["KRW-B"]), poolMarkets: ["KRW-A", "KRW-B"] }), /files of g1 differ from the manifest/);
  expectBuildError((root) => ({ g1: makeGroup(root, "g1", ["KRW-A"], { exclude: true }), g2: makeGroup(root, "g2", ["KRW-B"]), poolMarkets: ["KRW-A", "KRW-B"] }), /excludes a market/);
  expectBuildError((root) => ({ g1: makeGroup(root, "g1", ["KRW-A"]), g2: makeGroup(root, "g2", ["KRW-B"]), poolMarkets: ["KRW-A", "KRW-B", "KRW-C"] }), /differ from the committed discovery pool/);
  expectBuildError((root) => ({ g1: makeGroup(root, "g1", ["KRW-A"]), g2: makeGroup(root, "g2", ["KRW-A"]), poolMarkets: ["KRW-A"] }), /in two groups/);
});

test("the manifest hash is the one the fetch script prints and a non-empty output directory is refused", () => {
  const m = { files: { "a": { sha256: "1" } }, excluded: [], listingFirstDailyMs: { "KRW-A": 1 } };
  assert.equal(store.manifestHash(m), sha(JSON.stringify({ files: m.files, excluded: m.excluded, listing: m.listingFirstDailyMs })));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bbs-"));
  const g1 = makeGroup(root, "g1", ["KRW-A"]); const g2 = makeGroup(root, "g2", ["KRW-B"]);
  const out = path.join(root, "out"); fs.mkdirSync(out); fs.writeFileSync(path.join(out, "x"), "1");
  assert.throws(() => store.build({ groupDirs: { g1: g1.dir, g2: g2.dir }, committed: { g1: g1.hash, g2: g2.hash }, pool: pool(["KRW-A", "KRW-B"]), outDir: out }), /not empty/);
  fs.rmSync(root, { recursive: true, force: true });
});
