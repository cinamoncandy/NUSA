import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  calculateResearchCandleSha256,
  calculateResearchDatasetId,
  calculateResearchDatasetIdV2,
  type CanonicalResearchCandle,
  type HistoricalDatasetManifest,
  type ResearchDatasetProvenanceV2,
} from "../../contracts/src/researchDatasetSemantics";
import { SqliteDatabase } from "./index";
import { ResearchDatasetManifestStoreError, SqliteResearchDatasetManifestStore } from "./researchDatasetManifest";

const candles: readonly CanonicalResearchCandle[] = [
  { market: "KRW-BTC", interval: "1m", openTime: 1_700_000_000_000, closeTime: 1_700_000_059_999, open: 100, high: 110, low: 90, close: 105, volume: 10 },
  { market: "KRW-BTC", interval: "1m", openTime: 1_700_000_060_000, closeTime: 1_700_000_119_999, open: 105, high: 115, low: 100, close: 112, volume: 12 },
];

const sha = (char: string): string => char.repeat(64);
const provenance = (): ResearchDatasetProvenanceV2 => ({
  rawSourceIdentitySha256s: [sha("1"), sha("2")],
  transformationGraphSha256: sha("3"),
  transformationConfigSha256: sha("4"),
  schemaContractSha256: sha("5"),
  qualitySuiteSha256: sha("6"),
  qualityResultsSha256: sha("7"),
  derivedFeatureLineageSha256: sha("8"),
  replayRuntimeSha256: sha("9"),
});

function v2Manifest(p: ResearchDatasetProvenanceV2 = provenance()): HistoricalDatasetManifest {
  const contentSha256 = calculateResearchCandleSha256(candles);
  return {
    schemaVersion: 2,
    datasetId: calculateResearchDatasetIdV2("UPBIT", candles, contentSha256, p),
    source: "UPBIT",
    market: "KRW-BTC",
    interval: "1m",
    candleCount: candles.length,
    startOpenTime: candles[0]!.openTime,
    endCloseTime: candles.at(-1)!.closeTime,
    timezone: "UTC",
    ordering: "OPEN_TIME_ASC",
    missingCandlePolicy: "REJECT",
    missingCandleCount: 0,
    createdAt: "2026-10-17T00:00:00.000Z",
    contentSha256,
    provenance: p,
  };
}

function withStore(run: (store: SqliteResearchDatasetManifestStore, db: SqliteDatabase) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "nusa-dataset-manifest-"));
  const db = new SqliteDatabase(join(dir, "state.db"));
  try { run(new SqliteResearchDatasetManifestStore(db), db); } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
}

function expectCode(run: () => unknown, code: string): void {
  assert.throws(run, (error: unknown) => error instanceof ResearchDatasetManifestStoreError && error.code === code);
}

describe("research dataset manifest transitive provenance", () => {
  it("changes v2 identity when any material provenance dimension changes while candle bytes stay equal", () => {
    const base = provenance();
    const baseId = v2Manifest(base).datasetId;
    const variants: ResearchDatasetProvenanceV2[] = [
      { ...base, rawSourceIdentitySha256s: [sha("1"), sha("a")] },
      { ...base, transformationGraphSha256: sha("a") },
      { ...base, transformationConfigSha256: sha("a") },
      { ...base, schemaContractSha256: sha("a") },
      { ...base, qualitySuiteSha256: sha("a") },
      { ...base, qualityResultsSha256: sha("a") },
      { ...base, derivedFeatureLineageSha256: sha("a") },
      { ...base, replayRuntimeSha256: sha("a") },
    ];
    for (const changed of variants) assert.notEqual(v2Manifest(changed).datasetId, baseId);
  });

  it("canonicalizes raw source identity ordering", () => {
    const base = provenance();
    const reversed = { ...base, rawSourceIdentitySha256s: [...base.rawSourceIdentitySha256s].reverse() };
    assert.equal(v2Manifest(base).datasetId, v2Manifest(reversed).datasetId);
  });

  it("rejects missing, malformed and duplicate v2 provenance fail-closed", () => withStore((store) => {
    const missing = { ...v2Manifest() } as HistoricalDatasetManifest;
    delete (missing as { provenance?: ResearchDatasetProvenanceV2 }).provenance;
    expectCode(() => store.persist(missing), "MANIFEST_PROVENANCE_REQUIRED");

    const malformed = { ...provenance(), replayRuntimeSha256: "not-a-sha256" } as ResearchDatasetProvenanceV2;
    expectCode(() => store.persist({ ...v2Manifest(), provenance: malformed }), "MANIFEST_PROVENANCE_INVALID");

    const duplicate = { ...provenance(), rawSourceIdentitySha256s: [sha("1"), sha("1")] };
    expectCode(() => store.persist({ ...v2Manifest(), provenance: duplicate }), "MANIFEST_PROVENANCE_INVALID");
  }));

  it("persists and verifies a valid v2 manifest and rejects a provenance/id mismatch", () => withStore((store) => {
    const manifest = v2Manifest();
    const fingerprint = store.persistVerified(manifest, candles);
    assert.match(fingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(store.read(manifest.datasetId), manifest);

    const changed = { ...provenance(), qualityResultsSha256: sha("a") };
    expectCode(() => store.persistVerified({ ...manifest, provenance: changed }, candles), "MANIFEST_CONTENT_MISMATCH");
  }));

  it("keeps legacy v1 identity and verified persistence unchanged without rewriting historical evidence", () => withStore((store) => {
    const contentSha256 = calculateResearchCandleSha256(candles);
    const manifest: HistoricalDatasetManifest = {
      schemaVersion: 1,
      datasetId: calculateResearchDatasetId("UPBIT", candles, contentSha256),
      source: "UPBIT",
      market: "KRW-BTC",
      interval: "1m",
      candleCount: candles.length,
      startOpenTime: candles[0]!.openTime,
      endCloseTime: candles.at(-1)!.closeTime,
      timezone: "UTC",
      ordering: "OPEN_TIME_ASC",
      missingCandlePolicy: "REJECT",
      missingCandleCount: 0,
      createdAt: "2026-10-17T00:00:00.000Z",
      contentSha256,
    };
    store.persistVerified(manifest, candles);
    assert.deepEqual(store.read(manifest.datasetId), manifest);
    expectCode(() => store.persist({ ...manifest, provenance: provenance() }), "MANIFEST_SCHEMA_MISMATCH");
  }));
});
