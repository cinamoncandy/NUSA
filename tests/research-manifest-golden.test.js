"use strict";
// GOLDEN equivalence guard for the dataset manifest build (WO-OPS-20261117-MANIFEST-ISOLATION). Whatever way the build is later moved off the
// collector's thread (fewer reads, chunked reads that yield, a worker), the manifest it produces for the same input must stay BYTE-identical.
// The hashes below were computed from the implementation on main at the time this test was written; a change here is a change of dataset identity.
const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { createHash } = require("node:crypto");
const { SqliteDatabase, SqliteResearchCandleStore, SqliteResearchDatasetManifestStore } = require("../dist/packages/storage/src/index.js");
const { materializeResearchDatasetManifest } = require("../dist/apps/cloud/src/researchDatasetManifestMaterializer.js");
const { UPBIT_CANDLE_SOURCE_FINGERPRINT } = require("../dist/apps/cloud/src/researchCandleBackfill.js");
const { AggregatedResearchCandleSource } = require("../dist/apps/cloud/src/researchCandleAggregation.js");

// The manifest identity (replayRuntimeSha256) includes process.version, so the same data gets a different datasetId on another Node version
// (local Node 22 vs CI Node 24). Pin it here so the golden values below test the build, not the runtime that happens to run the test.
Object.defineProperty(process, "version", { value: "v0.0.0-golden", configurable: true });

const M = 60_000;
const BASE = Math.floor(Date.UTC(2026, 10, 1) / M) * M;
const SHA = "a".repeat(40);
const CREATED_AT = "2026-11-17T00:00:00.000Z";
const sha = (value) => createHash("sha256").update(value, "utf8").digest("hex");

function seed(db, { minutes, skip = [], page = 200 }) {
  const cs = new SqliteResearchCandleStore(db);
  const skipped = new Set(skip);
  for (let p = 0; p * page < minutes; p += 1) {
    const rows = [];
    for (let i = 0; i < page && p * page + i < minutes; i += 1) {
      const idx = p * page + i;
      if (skipped.has(idx)) continue;
      const px = 100 + (idx % 50);
      rows.push({ closeTimeMs: BASE + (idx + 1) * M, open: px, high: px + 1, low: px - 1, close: px + 0.5, volume: 10 + (idx % 5) });
    }
    if (rows.length === 0) continue;
    cs.appendWithMaterial("KRW-BTC", M, rows, { source: "UPBIT_PUBLIC_CANDLES", sourceFingerprint: UPBIT_CANDLE_SOURCE_FINGERPRINT, evidenceFingerprintSha256: String(p).padStart(64, "a"), missingBuckets: 0, incompleteBuckets: 0, rejectedObservations: 0 });
  }
  return cs;
}

function build(scenario) {
  const dir = mkdtempSync(join(tmpdir(), "nusa-manifest-golden-"));
  const db = new SqliteDatabase(join(dir, "state.db"));
  try {
    const cs = seed(db, scenario);
    const ms = new SqliteResearchDatasetManifestStore(db);
    for (const run of scenario.absences ?? []) {
      assert.equal(cs.recordAbsence({ market: "KRW-BTC", intervalMs: M, firstAbsentCloseMs: BASE + (run[0] + 1) * M, lastAbsentCloseMs: BASE + (run[1] + 1) * M, beforeCloseMs: BASE + run[0] * M, afterCloseMs: BASE + (run[1] + 2) * M, evidenceFingerprintSha256: "c".repeat(64), observedAt: "2026-11-16T00:00:00.000Z" }), true);
    }
    const first = BASE + M; const last = BASE + scenario.minutes * M;
    const intervalMs = scenario.minutes_per_bar * M;
    const bars = scenario.minutes_per_bar === 1 ? cs.read("KRW-BTC", M, first, last) : new AggregatedResearchCandleSource(cs, M).read("KRW-BTC", intervalMs, first, last);
    const source = scenario.minutes_per_bar === 1 ? `upbit-1m-closed:KRW-BTC:${M}` : `upbit-1m-aggregated:KRW-BTC:${intervalMs}`;
    const manifest = materializeResearchDatasetManifest({ store: ms, candleStore: cs, market: "KRW-BTC", intervalMs, candles: bars, source, createdAt: CREATED_AT, sourceCommitSha: SHA });
    const persisted = ms.read(manifest.datasetId);
    assert.deepEqual(persisted, manifest, "the stored manifest equals the returned one");
    return { manifestSha: sha(JSON.stringify(manifest)), bars: bars.length, datasetId: manifest.datasetId };
  } finally { db.close(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may hold the handle a moment */ } }
}

const SCENARIOS = {
  "1m, gap-free, 1000 candles": { minutes: 1000, minutes_per_bar: 1 },
  "15m, gap-free, 1500 candles": { minutes: 1500, minutes_per_bar: 15 },
  "60m, gap-free, 3000 candles": { minutes: 3000, minutes_per_bar: 60 },
  "1m with one exchange-confirmed absence run": { minutes: 1000, minutes_per_bar: 1, skip: [499, 500, 501], absences: [[499, 501]] },
  "15m over a 1m series with a confirmed absence": { minutes: 1500, minutes_per_bar: 15, skip: [749, 750], absences: [[749, 750]] },
};

const GOLDEN_EXPECTED = {
  "1m, gap-free, 1000 candles": { manifestSha: "ad1a8f7ee92a655cc29a75d806df2e648f300392c1472068dd7cda6c7a9531eb", bars: 1000, datasetId: "upbit-1m-closed-KRW-BTC-60000_KRW-BTC_1m_20261101_20261101_v2_831655a1070b_9918c026b2e6" },
  "15m, gap-free, 1500 candles": { manifestSha: "12834f8024cc70c0b24a6acfe584d81cd7d63220d3daf7da8d54b1b83c9c75f0", bars: 100, datasetId: "upbit-1m-aggregated-KRW-BTC-900000_KRW-BTC_15m_20261101_20261102_v2_248e3779a44c_daf2aa7556bf" },
  "60m, gap-free, 3000 candles": { manifestSha: "cba9295464fda112b3208598c42b29c4324906d869fdbd981929e146cd7f2da9", bars: 50, datasetId: "upbit-1m-aggregated-KRW-BTC-3600000_KRW-BTC_60m_20261101_20261103_v2_22437207c577_eb01a2202ec0" },
  "1m with one exchange-confirmed absence run": { manifestSha: "4ed46fdb2d17a3b9377fe4b4c3c6451cae9cfb80933508cfc8ed411c859668f9", bars: 997, datasetId: "upbit-1m-closed-KRW-BTC-60000_KRW-BTC_1m_20261101_20261101_v2_e0a9a4d9d1b9_e0c3f5593ee6" },
  "15m over a 1m series with a confirmed absence": { manifestSha: "967efda618da1f031d4c4baefcd2aa1e904c2b2084ca187da8cd3b749c043dce", bars: 98, datasetId: "upbit-1m-aggregated-KRW-BTC-900000_KRW-BTC_15m_20261101_20261102_v2_62d249c7ea0b_6756f73b1e7a" },
};

test("the manifest build is deterministic: the same input twice gives the same manifest", () => {
  for (const [name, scenario] of Object.entries(SCENARIOS)) assert.deepEqual(build(scenario), build(scenario), name);
});

test("the manifest of each scenario is byte-identical to the golden value", () => {
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    const got = build(scenario);
    assert.ok(GOLDEN_EXPECTED[name], `no golden value for ${name}`);
    assert.deepEqual(got, GOLDEN_EXPECTED[name], name);
  }
});


// The receipt-coverage check reads no rows any more (it tests each stored candle against the receipts' inclusive close ranges), so its
// refusal is pinned here: a candle no receipt covers (the store itself already refuses receipts that overlap or disagree with the candles).
function materializeWith(mutate) {
  const dir = mkdtempSync(join(tmpdir(), "nusa-manifest-receipts-"));
  const db = new SqliteDatabase(join(dir, "state.db"));
  try {
    const cs = seed(db, { minutes: 1000, page: 200 });
    mutate(db);
    const ms = new SqliteResearchDatasetManifestStore(db);
    const first = BASE + M; const last = BASE + 1000 * M;
    const bars = cs.read("KRW-BTC", M, first, last);
    return materializeResearchDatasetManifest({ store: ms, candleStore: cs, market: "KRW-BTC", intervalMs: M, candles: bars, source: `upbit-1m-closed:KRW-BTC:${M}`, createdAt: CREATED_AT, sourceCommitSha: SHA });
  } finally { db.close(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may hold the handle a moment */ } }
}

test("a stored candle that no receipt covers still refuses the manifest", () => {
  assert.throws(() => materializeWith((db) => db.connection.prepare("DELETE FROM research_dataset_material WHERE last_close_time_ms = (SELECT MIN(last_close_time_ms) FROM research_dataset_material)").run()),
    (error) => error.code === "MANIFEST_PROVENANCE_REQUIRED" && /receipts do not cover/.test(error.message));
});
