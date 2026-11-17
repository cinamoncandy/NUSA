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
  "1m, gap-free, 1000 candles": { manifestSha: "86ae7f7bd3cc0edbe8b5d4b0d3e06d216ab66e81a433fa75fa950b9e2414000b", bars: 1000, datasetId: "upbit-1m-closed-KRW-BTC-60000_KRW-BTC_1m_20261101_20261101_v2_831655a1070b_8234749ed570" },
  "15m, gap-free, 1500 candles": { manifestSha: "c8bf86c56e55278233320159a498b96199edf98c2206ad514f201d9a78a223a3", bars: 100, datasetId: "upbit-1m-aggregated-KRW-BTC-900000_KRW-BTC_15m_20261101_20261102_v2_248e3779a44c_afba5571f4d5" },
  "60m, gap-free, 3000 candles": { manifestSha: "d29a6996c0cdf73632cc1c568d0e8631ed7d7c0123cfa9ffe2304a638314e383", bars: 50, datasetId: "upbit-1m-aggregated-KRW-BTC-3600000_KRW-BTC_60m_20261101_20261103_v2_22437207c577_6eff7092e7d5" },
  "1m with one exchange-confirmed absence run": { manifestSha: "a60ada6ec2bccefdd6fa925194dba24aff3d17f185b7b154e6ba4a005abdad26", bars: 997, datasetId: "upbit-1m-closed-KRW-BTC-60000_KRW-BTC_1m_20261101_20261101_v2_e0a9a4d9d1b9_4e51f1c76cd5" },
  "15m over a 1m series with a confirmed absence": { manifestSha: "79c01af48df9d6b12dae4349ac6a160680a79601db964f467b3900f865190a9d", bars: 98, datasetId: "upbit-1m-aggregated-KRW-BTC-900000_KRW-BTC_15m_20261101_20261102_v2_62d249c7ea0b_9bb96b30ebed" },
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

