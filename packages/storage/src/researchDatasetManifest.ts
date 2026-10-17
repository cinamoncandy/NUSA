import { createHash } from "node:crypto";
import { calculateResearchCandleSha256, calculateResearchDatasetId, calculateResearchDatasetIdV2, canonicalSerializeResearchDatasetProvenanceV2, type CanonicalResearchCandle, type HistoricalDatasetManifest } from "../../contracts/src/researchDatasetSemantics";
import type { SqliteDatabase } from "./index";

const TABLE = "research_dataset_manifests";

function fingerprint(manifest: HistoricalDatasetManifest): string {
  return createHash("sha256").update(JSON.stringify(manifest), "utf8").digest("hex");
}

function validateManifestSchema(manifest: HistoricalDatasetManifest): void {
  if (manifest.schemaVersion === 1) {
    if (manifest.provenance != null) throw new ResearchDatasetManifestStoreError("MANIFEST_SCHEMA_MISMATCH", "legacy v1 manifest must not carry v2 provenance");
    return;
  }
  if (manifest.schemaVersion !== 2) throw new ResearchDatasetManifestStoreError("MANIFEST_SCHEMA_UNSUPPORTED", "dataset manifest schema version is unsupported");
  if (manifest.provenance == null) throw new ResearchDatasetManifestStoreError("MANIFEST_PROVENANCE_REQUIRED", "v2 dataset manifest requires transitive provenance");
  try { canonicalSerializeResearchDatasetProvenanceV2(manifest.provenance); } catch (error) {
    throw new ResearchDatasetManifestStoreError("MANIFEST_PROVENANCE_INVALID", error instanceof Error ? error.message : "v2 dataset provenance is invalid");
  }
}

export class ResearchDatasetManifestStoreError extends Error {
  public constructor(readonly code: string, message: string) { super(message); this.name = "ResearchDatasetManifestStoreError"; }
}

export class SqliteResearchDatasetManifestStore {
  public constructor(private readonly db: SqliteDatabase) {
    this.db.connection.exec(`CREATE TABLE IF NOT EXISTS ${TABLE} (dataset_id TEXT PRIMARY KEY, manifest_json TEXT NOT NULL, manifest_sha256 TEXT NOT NULL)`);
  }

  public persist(manifest: HistoricalDatasetManifest): string {
    validateManifestSchema(manifest);
    const manifestJson = JSON.stringify(manifest);
    const manifestSha256 = fingerprint(manifest);
    const existing = this.db.connection.prepare(`SELECT manifest_json AS manifestJson, manifest_sha256 AS manifestSha256 FROM ${TABLE} WHERE dataset_id = ?`).get(manifest.datasetId) as { manifestJson: string; manifestSha256: string } | undefined;
    if (existing != null && (existing.manifestJson !== manifestJson || existing.manifestSha256 !== manifestSha256)) throw new ResearchDatasetManifestStoreError("MANIFEST_CONFLICT", "a different manifest already exists for this datasetId");
    if (existing == null) this.db.connection.prepare(`INSERT INTO ${TABLE} (dataset_id, manifest_json, manifest_sha256) VALUES (?, ?, ?)`).run(manifest.datasetId, manifestJson, manifestSha256);
    return manifestSha256;
  }

  public persistVerified(manifest: HistoricalDatasetManifest, candles: readonly CanonicalResearchCandle[]): string {
    validateManifestSchema(manifest);
    const contentSha256 = calculateResearchCandleSha256(candles);
    const expectedDatasetId = manifest.schemaVersion === 2
      ? calculateResearchDatasetIdV2(manifest.source, candles, contentSha256, manifest.provenance!)
      : calculateResearchDatasetId(manifest.source, candles, contentSha256);
    if (manifest.contentSha256 !== contentSha256 || manifest.datasetId !== expectedDatasetId) throw new ResearchDatasetManifestStoreError("MANIFEST_CONTENT_MISMATCH", "manifest does not match canonical candle content and provenance identity");
    return this.persist(manifest);
  }

  public read(datasetId: string): HistoricalDatasetManifest {
    const row = this.db.connection.prepare(`SELECT manifest_json AS manifestJson, manifest_sha256 AS manifestSha256 FROM ${TABLE} WHERE dataset_id = ?`).get(datasetId) as { manifestJson: string; manifestSha256: string } | undefined;
    if (row == null) throw new ResearchDatasetManifestStoreError("MANIFEST_NOT_FOUND", "dataset manifest is missing");
    let manifest: HistoricalDatasetManifest;
    try { manifest = JSON.parse(row.manifestJson) as HistoricalDatasetManifest; } catch { throw new ResearchDatasetManifestStoreError("MANIFEST_CORRUPT", "dataset manifest JSON is invalid"); }
    if (manifest.datasetId !== datasetId || fingerprint(manifest) !== row.manifestSha256) throw new ResearchDatasetManifestStoreError("MANIFEST_CHECKSUM_MISMATCH", "dataset manifest fingerprint does not match persisted content");
    validateManifestSchema(manifest);
    return Object.freeze(manifest);
  }

  public latest(market: string, interval: string): HistoricalDatasetManifest | undefined {
    const rows = this.db.connection.prepare(`SELECT manifest_json AS manifestJson FROM ${TABLE} ORDER BY rowid DESC`).all() as Array<{ manifestJson: string }>;
    for (const row of rows) {
      let manifest: HistoricalDatasetManifest;
      try { manifest = JSON.parse(row.manifestJson) as HistoricalDatasetManifest; } catch { throw new ResearchDatasetManifestStoreError("MANIFEST_CORRUPT", "dataset manifest JSON is invalid"); }
      validateManifestSchema(manifest);
      if (manifest.market === market && manifest.interval === interval) return Object.freeze(manifest);
    }
    return undefined;
  }
}
