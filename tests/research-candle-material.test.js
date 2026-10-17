const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { SqliteDatabase, SqliteResearchCandleStore, SqliteResearchDatasetManifestStore } = require("../dist/packages/storage/src/index.js");
const { calculateResearchCandleSha256, calculateResearchDatasetId } = require("../dist/packages/contracts/src/index.js");
const { materializeResearchDatasetManifest } = require("../dist/apps/cloud/src/researchDatasetManifestMaterializer.js");

function candles() {
  return [
    { closeTimeMs: 60_000, open: 100, high: 101, low: 99, close: 100.5 },
    { closeTimeMs: 120_000, open: 100.5, high: 102, low: 100, close: 101 },
  ];
}

test("dataset material survives SQLite restart and binds to candle content", () => {
  const dir = mkdtempSync(join(tmpdir(), "nusa-dataset-material-"));
  const filename = join(dir, "state.db");
  try {
    const first = new SqliteDatabase(filename);
    const store = new SqliteResearchCandleStore(first);
    store.appendWithMaterial("KRW-BTC", 60_000, candles(), { source: "UPBIT_PUBLIC_TICKER", evidenceFingerprintSha256: "a".repeat(64), missingBuckets: 0, incompleteBuckets: 0, rejectedObservations: 0 });
    const material = store.latestMaterial("KRW-BTC", 60_000);
    assert.ok(material);
    first.close();
    const reopened = new SqliteDatabase(filename);
    const restored = new SqliteResearchCandleStore(reopened).readMaterial("KRW-BTC", 60_000, material.firstCloseTimeMs, material.lastCloseTimeMs, material.storeContentSha256);
    assert.equal(restored.source, "UPBIT_PUBLIC_TICKER");
    assert.equal(restored.candleCount, 2);
    reopened.close();
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may release the SQLite handle after the test turn. */ } }
});

test("canonical dataset manifest survives SQLite restart and verifies its fingerprint", () => {
  const dir = mkdtempSync(join(tmpdir(), "nusa-dataset-manifest-"));
  const filename = join(dir, "state.db");
  const manifest = { schemaVersion: 1, datasetId: "source_KRW-BTC_1m_19700101_19700101_abc", source: "UPBIT_PUBLIC_TICKER", market: "KRW-BTC", interval: "1m", candleCount: 2, startOpenTime: 0, endCloseTime: 120_000, timezone: "UTC", ordering: "OPEN_TIME_ASC", missingCandlePolicy: "REJECT", missingCandleCount: 0, createdAt: "1970-01-01T00:00:00.000Z", contentSha256: "a".repeat(64) };
  try {
    const first = new SqliteDatabase(filename);
    const store = new SqliteResearchDatasetManifestStore(first);
    const fingerprint = store.persist(manifest);
    assert.equal(fingerprint.length, 64);
    first.close();
    const reopened = new SqliteDatabase(filename);
    assert.deepEqual(new SqliteResearchDatasetManifestStore(reopened).read(manifest.datasetId), manifest);
    reopened.close();
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may release the SQLite handle after the test turn. */ } }
});

test("canonical dataset manifest rejects identity substitution", () => {
  const db = new SqliteDatabase(":memory:");
  const store = new SqliteResearchDatasetManifestStore(db);
  const manifest = { schemaVersion: 1, datasetId: "dataset-a", source: "source-a", market: "KRW-BTC", interval: "1m", candleCount: 1, startOpenTime: 0, endCloseTime: 60_000, timezone: "UTC", ordering: "OPEN_TIME_ASC", missingCandlePolicy: "REJECT", missingCandleCount: 0, createdAt: "1970-01-01T00:00:00.000Z", contentSha256: "a".repeat(64) };
  store.persist(manifest);
  assert.throws(() => store.persist({ ...manifest, source: "source-b" }), /different manifest already exists/);
  db.close();
});

test("verified manifest persistence rejects content substitution", () => {
  const db = new SqliteDatabase(":memory:");
  const store = new SqliteResearchDatasetManifestStore(db);
  const candles = [{ market: "KRW-BTC", interval: "1m", openTime: 0, closeTime: 60_000, open: 100, high: 101, low: 99, close: 100.5, volume: 0 }];
  const contentSha256 = calculateResearchCandleSha256(candles);
  const manifest = { schemaVersion: 1, datasetId: calculateResearchDatasetId("source", candles, contentSha256), source: "source", market: "KRW-BTC", interval: "1m", candleCount: 1, startOpenTime: 0, endCloseTime: 60_000, timezone: "UTC", ordering: "OPEN_TIME_ASC", missingCandlePolicy: "REJECT", missingCandleCount: 0, createdAt: "1970-01-01T00:00:00.000Z", contentSha256 };
  assert.equal(store.persistVerified(manifest, candles).length, 64);
  assert.throws(() => store.persistVerified(manifest, [{ ...candles[0], close: 100.6 }]), /manifest does not match/);
  db.close();
});

test("manifest materializer rejects missing volume and non-contiguous candles", () => {
  const db = new SqliteDatabase(":memory:");
  const store = new SqliteResearchDatasetManifestStore(db);
  const base = { store, market: "KRW-BTC", intervalMs: 60_000, source: "upbit", createdAt: "1970-01-01T00:00:00.000Z" };
  assert.throws(() => materializeResearchDatasetManifest({ ...base, candles: [{ closeTimeMs: 60_000, open: 1, high: 1, low: 1, close: 1 }] }), /explicit OHLCV/);
  assert.throws(() => materializeResearchDatasetManifest({ ...base, candles: [{ closeTimeMs: 60_000, open: 1, high: 1, low: 1, close: 1, volume: 1 }, { closeTimeMs: 180_000, open: 1, high: 1, low: 1, close: 1, volume: 1 }] }), /missing intervals/);
  db.close();
});

test("foreign material reference is rejected", () => {
  const db = new SqliteDatabase(":memory:");
  const store = new SqliteResearchCandleStore(db);
  store.appendWithMaterial("KRW-BTC", 60_000, candles(), { source: "UPBIT_PUBLIC_TICKER", missingBuckets: 0, incompleteBuckets: 0, rejectedObservations: 0 });
  const material = store.latestMaterial("KRW-BTC", 60_000);
  assert.throws(() => store.readMaterial("KRW-BTC", 60_000, material.firstCloseTimeMs, material.lastCloseTimeMs, "b".repeat(64)), /dataset material is missing/);
  db.close();
});

test("tampered candle content is rejected on material read-back", () => {
  const db = new SqliteDatabase(":memory:");
  const store = new SqliteResearchCandleStore(db);
  store.appendWithMaterial("KRW-BTC", 60_000, candles(), { source: "UPBIT_PUBLIC_TICKER", missingBuckets: 0, incompleteBuckets: 0, rejectedObservations: 0 });
  const material = store.latestMaterial("KRW-BTC", 60_000);
  db.connection.prepare("UPDATE research_closed_candles SET close = ? WHERE market = ? AND interval_ms = ? AND close_time_ms = ?").run(999, "KRW-BTC", 60_000, 60_000);
  assert.throws(() => store.readMaterial("KRW-BTC", 60_000, material.firstCloseTimeMs, material.lastCloseTimeMs, material.storeContentSha256), /research candle (high\/low|checksum)/);
  db.close();
});
