import { createHash } from "node:crypto";
import type { SqliteDatabase } from "../../../packages/storage/src/index";
import type { MobileDashboardApiInput } from "./mobileDashboardApi";

export const CLOUD_DASHBOARD_SNAPSHOT_SCHEMA_VERSION = 1;

export interface CloudDashboardSnapshot {
  readonly schemaVersion: number;
  readonly sourceCommit: string;
  readonly sourceVersion: string;
  readonly generatedAt: number;
  readonly savedAt: number;
  readonly payload: MobileDashboardApiInput;
}

export interface CloudDashboardSnapshotRepository {
  save(snapshot: CloudDashboardSnapshot): void;
  loadLatest(): CloudDashboardSnapshot | undefined;
  clear(): void;
  close(): void;
}

const SNAPSHOT_ID = "latest";

function snapshotContent(snapshot: CloudDashboardSnapshot): string {
  return JSON.stringify({
    schemaVersion: snapshot.schemaVersion,
    sourceCommit: snapshot.sourceCommit,
    sourceVersion: snapshot.sourceVersion,
    generatedAt: snapshot.generatedAt,
    savedAt: snapshot.savedAt,
    payload: snapshot.payload
  });
}

function checksum(snapshot: CloudDashboardSnapshot): string {
  return createHash("sha256").update(snapshotContent(snapshot), "utf8").digest("hex");
}

function assertSnapshot(snapshot: CloudDashboardSnapshot): void {
  if (snapshot.schemaVersion !== CLOUD_DASHBOARD_SNAPSHOT_SCHEMA_VERSION) throw new Error("unsupported dashboard snapshot schema");
  if (!Number.isSafeInteger(snapshot.generatedAt) || snapshot.generatedAt < 0) throw new Error("invalid dashboard snapshot generatedAt");
  if (!Number.isSafeInteger(snapshot.savedAt) || snapshot.savedAt < snapshot.generatedAt) throw new Error("invalid dashboard snapshot savedAt");
  if (!snapshot.sourceCommit.trim() || !snapshot.sourceVersion.trim()) throw new Error("dashboard snapshot provenance is required");
  if (!snapshot.payload || snapshot.payload.mode !== "PAPER") throw new Error("dashboard snapshot must remain PAPER");
}

type SnapshotRow = Record<string, string | number | bigint | null>;

function decodeSnapshot(row: SnapshotRow): CloudDashboardSnapshot | undefined {
  try {
    const payload = JSON.parse(String(row.payload_json)) as MobileDashboardApiInput;
    const snapshot: CloudDashboardSnapshot = Object.freeze({
      schemaVersion: Number(row.schema_version),
      sourceCommit: String(row.source_commit),
      sourceVersion: String(row.source_version),
      generatedAt: Number(row.generated_at),
      savedAt: Number(row.saved_at),
      payload
    });
    assertSnapshot(snapshot);
    if (String(row.checksum) !== checksum(snapshot)) return undefined;
    return snapshot;
  } catch {
    return undefined;
  }
}

export class SqliteCloudDashboardSnapshotRepository implements CloudDashboardSnapshotRepository {
  private closed = false;

  public constructor(private readonly db: SqliteDatabase) {}

  public save(snapshot: CloudDashboardSnapshot): void {
    assertSnapshot(snapshot);
    const payloadJson = JSON.stringify(snapshot.payload);
    this.db.transaction(() => {
      this.db.connection.prepare(`
        INSERT INTO cloud_dashboard_snapshots
          (snapshot_id, schema_version, source_commit, source_version, generated_at, saved_at, payload_json, checksum, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'VALID')
        ON CONFLICT(snapshot_id) DO UPDATE SET
          schema_version=excluded.schema_version,
          source_commit=excluded.source_commit,
          source_version=excluded.source_version,
          generated_at=excluded.generated_at,
          saved_at=excluded.saved_at,
          payload_json=excluded.payload_json,
          checksum=excluded.checksum,
          status='VALID'
      `).run(SNAPSHOT_ID, snapshot.schemaVersion, snapshot.sourceCommit, snapshot.sourceVersion, snapshot.generatedAt, snapshot.savedAt, payloadJson, checksum(snapshot));
    });
  }

  public loadLatest(): CloudDashboardSnapshot | undefined {
    if (this.closed) throw new Error("dashboard snapshot repository is closed");
    const row = this.db.connection.prepare("SELECT * FROM cloud_dashboard_snapshots WHERE snapshot_id = ? AND status = 'VALID'").get(SNAPSHOT_ID) as SnapshotRow | undefined;
    if (row == null) return undefined;
    const snapshot = decodeSnapshot(row);
    if (snapshot != null) return snapshot;
    this.db.connection.prepare("UPDATE cloud_dashboard_snapshots SET status = 'CORRUPTED' WHERE snapshot_id = ?").run(SNAPSHOT_ID);
    return undefined;
  }

  public clear(): void {
    if (this.closed) return;
    this.db.transaction(() => { this.db.connection.prepare("DELETE FROM cloud_dashboard_snapshots").run(); });
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}

export function dashboardSnapshotChecksum(snapshot: CloudDashboardSnapshot): string {
  assertSnapshot(snapshot);
  return checksum(snapshot);
}
