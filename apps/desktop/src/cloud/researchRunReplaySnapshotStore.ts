import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  replayResearchRunWithPaperEvidence,
  validateResearchRunReplaySnapshotIntegrity,
  type ResearchRunReplaySnapshot,
} from "./researchRunReplaySnapshot";

const FORBIDDEN_KEY = /(authorization|bearer|token|secret|password|api[_-]?key|access[_-]?key|private[_-]?key|cookie|jwt|credential)/i;
const SHA64 = /^[0-9a-f]{64}$/;
const CANONICAL_ARCHIVE_PREFIX = Buffer.from('{"schemaVersion":1,"snapshots":[');
const STREAM_CHUNK_BYTES = 64 * 1024;
const LATEST_IDENTITY_SIDECAR_SUFFIX = ".latest-identity.json";
const LEGACY_SEGMENTED_MIGRATION_GUARD = "SEGMENTED_PERSISTENCE_REQUIRES_NEW_READER";
const CATALOG_SIDECAR_SUFFIX = ".catalog.json";
const SEGMENT_DIRECTORY_SUFFIX = ".segments";

interface ResearchRunReplaySnapshotLocation {
  readonly offset: number;
  readonly length: number;
}

interface ResearchRunReplaySnapshotLatestIdentitySidecar extends ResearchRunReplaySnapshotIdentity, ResearchRunReplaySnapshotLocation {
  readonly schemaVersion: 1;
  readonly archiveKey: string;
  readonly snapshotSha256: string;
}

interface ResearchRunReplaySnapshotFile {
  readonly schemaVersion: 1;
  readonly snapshots: readonly ResearchRunReplaySnapshot[];
}

interface ResearchRunReplaySnapshotCatalogEntry extends ResearchRunReplaySnapshotIdentity {
  readonly source: "archive" | "segment";
  readonly snapshotSha256: string;
  readonly generatedAtMs: number;
  readonly offset?: number;
  readonly length?: number;
  readonly segmentFile?: string;
  readonly segmentKey?: string;
}

interface ResearchRunReplaySnapshotCatalog {
  readonly schemaVersion: 1;
  readonly archiveKey: string;
  readonly entries: readonly ResearchRunReplaySnapshotCatalogEntry[];
}


export interface ResearchRunReplaySnapshotIdentity {
  readonly originalRunFingerprintSha256: string;
  readonly generatedAt: string;
}

function rejectForbidden(value: unknown, seen = new Set<object>()): void {
  if (value == null || typeof value !== "object") return;
  if (seen.has(value)) throw new Error("research replay snapshot must be acyclic");
  seen.add(value);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error("research replay snapshot contains a forbidden field");
    rejectForbidden(child, seen);
  }
  seen.delete(value);
}

function validate(snapshot: ResearchRunReplaySnapshot): ResearchRunReplaySnapshot {
  rejectForbidden(snapshot);
  replayResearchRunWithPaperEvidence(snapshot, Object.freeze({}));
  return snapshot;
}

function validateIntegrity(snapshot: ResearchRunReplaySnapshot): ResearchRunReplaySnapshot {
  rejectForbidden(snapshot);
  validateResearchRunReplaySnapshotIntegrity(snapshot);
  return snapshot;
}

function parseValidatedSnapshot(encoded: Buffer): ResearchRunReplaySnapshot {
  let parsed: ResearchRunReplaySnapshot;
  try { parsed = JSON.parse(encoded.toString("utf8")) as ResearchRunReplaySnapshot; }
  catch { throw new Error("research replay snapshot file is corrupted"); }
  return validate(parsed);
}

function parseIntegrityValidatedSnapshot(encoded: Buffer): ResearchRunReplaySnapshot {
  let parsed: ResearchRunReplaySnapshot;
  try { parsed = JSON.parse(encoded.toString("utf8")) as ResearchRunReplaySnapshot; }
  catch { throw new Error("research replay snapshot file is corrupted"); }
  return validateIntegrity(parsed);
}

function snapshotGeneratedAt(snapshot: ResearchRunReplaySnapshot): number {
  const value = snapshot.options.generatedAt;
  if (typeof value !== "string" || !value.trim()) throw new Error("initial PAPER bootstrap Research generatedAt is unavailable");
  const timestamp = Date.parse(value);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error("initial PAPER bootstrap Research generatedAt is invalid");
  return timestamp;
}

function isWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09;
}

/**
 * Reads the canonical append-only archive one snapshot at a time. `read()` only needs one
 * fingerprint, but the old implementation materialized every historical Research snapshot in a
 * single JSON.parse. Production archives contain full walk-forward evidence and can be hundreds
 * of MiB, so that multiplied memory until the isolated Research worker hit its V8 heap limit.
 *
 * The normal path still performs full semantic replay validation. Bootstrap identity discovery and
 * exact-fingerprint lookup can opt into checksum/structure-only validation for unrelated history;
 * the selected snapshot is still replayed in full before any challenger deployment.
 */
function forEachValidatedSnapshot(
  filename: string,
  visit: (snapshot: ResearchRunReplaySnapshot, encoded: Buffer, location: ResearchRunReplaySnapshotLocation) => void,
  integrityOnly = false,
): void {
  if (!fs.existsSync(filename)) return;
  const stat = fs.statSync(filename);
  if (!stat.isFile()) throw new Error("research replay snapshot path is not a file");

  const fd = fs.openSync(filename, "r");
  try {
    const prefix = Buffer.alloc(CANONICAL_ARCHIVE_PREFIX.length);
    if (fs.readSync(fd, prefix, 0, prefix.length, 0) !== prefix.length || !prefix.equals(CANONICAL_ARCHIVE_PREFIX)) {
      throw new Error("research replay snapshot file is corrupted");
    }

    const fingerprints = new Set<string>();
    const chunk = Buffer.allocUnsafe(STREAM_CHUNK_BYTES);
    let position = CANONICAL_ARCHIVE_PREFIX.length;
    let objectParts: Buffer[] = [];
    let objectBytes = 0;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let started = false;
    let expectSeparator = false;
    let arrayClosedAt: number | undefined;
    let objectStartOffset = -1;

    const finishObject = (): void => {
      const encoded = Buffer.concat(objectParts, objectBytes);
      const checked = integrityOnly ? parseIntegrityValidatedSnapshot(encoded) : parseValidatedSnapshot(encoded);
      if (!SHA64.test(checked.originalRunFingerprintSha256) || fingerprints.has(checked.originalRunFingerprintSha256)) {
        throw new Error("research replay snapshot run identity is duplicated or invalid");
      }
      fingerprints.add(checked.originalRunFingerprintSha256);
      if (!Number.isSafeInteger(objectStartOffset) || objectStartOffset < CANONICAL_ARCHIVE_PREFIX.length) {
        throw new Error("research replay snapshot file is corrupted");
      }
      visit(checked, encoded, Object.freeze({ offset: objectStartOffset, length: encoded.length }));
      objectParts = [];
      objectBytes = 0;
      started = false;
      objectStartOffset = -1;
      expectSeparator = true;
    };

    while (arrayClosedAt == null) {
      const bytesRead = fs.readSync(fd, chunk, 0, chunk.length, position);
      if (bytesRead === 0) throw new Error("research replay snapshot file is corrupted");
      const chunkStart = position;
      position += bytesRead;
      let segmentStart = started ? 0 : -1;

      for (let index = 0; index < bytesRead; index += 1) {
        const byte = chunk[index]!;
        if (!started) {
          if (expectSeparator) {
            if (byte === 0x2c) { expectSeparator = false; continue; }
            if (byte === 0x5d) { arrayClosedAt = chunkStart + index + 1; break; }
            if (isWhitespace(byte)) continue;
            throw new Error("research replay snapshot file is corrupted");
          }
          if (byte === 0x5d) { arrayClosedAt = chunkStart + index + 1; break; }
          if (isWhitespace(byte)) continue;
          if (byte !== 0x7b) throw new Error("research replay snapshot file is corrupted");
          started = true;
          objectStartOffset = chunkStart + index;
          depth = 1;
          inString = false;
          escaped = false;
          segmentStart = index;
          continue;
        }

        if (inString) {
          if (escaped) escaped = false;
          else if (byte === 0x5c) escaped = true;
          else if (byte === 0x22) inString = false;
        } else {
          if (byte === 0x22) inString = true;
          else if (byte === 0x7b || byte === 0x5b) depth += 1;
          else if (byte === 0x7d || byte === 0x5d) depth -= 1;
          if (depth < 0) throw new Error("research replay snapshot file is corrupted");
          if (depth === 0) {
            const part = Buffer.from(chunk.subarray(segmentStart, index + 1));
            objectParts.push(part);
            objectBytes += part.length;
            segmentStart = -1;
            finishObject();
          }
        }
      }

      if (started && segmentStart >= 0) {
        const part = Buffer.from(chunk.subarray(segmentStart, bytesRead));
        objectParts.push(part);
        objectBytes += part.length;
      }
    }

    if (started || inString || depth !== 0 || arrayClosedAt == null) throw new Error("research replay snapshot file is corrupted");
    const remaining = stat.size - arrayClosedAt;
    if (remaining < 1 || remaining > STREAM_CHUNK_BYTES) throw new Error("research replay snapshot file is corrupted");
    const suffix = Buffer.alloc(remaining);
    if (fs.readSync(fd, suffix, 0, remaining, arrayClosedAt) !== remaining || suffix.toString("utf8").trim() !== "}") {
      throw new Error("research replay snapshot file is corrupted");
    }
  } finally {
    fs.closeSync(fd);
  }
}

function archiveIdentityKey(stat: fs.Stats): string {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
}

function latestIdentitySidecarPath(filename: string): string {
  return `${filename}${LATEST_IDENTITY_SIDECAR_SUFFIX}`;
}

function writeLatestIdentitySidecar(
  filename: string,
  snapshot: ResearchRunReplaySnapshot,
  location: ResearchRunReplaySnapshotLocation,
): void {
  const archiveStat = fs.statSync(filename);
  if (!archiveStat.isFile()) throw new Error("research replay snapshot path is not a file");
  const generatedAt = snapshot.options.generatedAt;
  if (typeof generatedAt !== "string" || !generatedAt.trim()) throw new Error("initial PAPER bootstrap Research generatedAt is unavailable");
  const sidecar = latestIdentitySidecarPath(filename);
  const temporary = `${sidecar}.${process.pid}.tmp`;
  const payload: ResearchRunReplaySnapshotLatestIdentitySidecar = Object.freeze({
    schemaVersion: 1,
    archiveKey: archiveIdentityKey(archiveStat),
    originalRunFingerprintSha256: snapshot.originalRunFingerprintSha256,
    generatedAt,
    snapshotSha256: snapshot.snapshotSha256,
    offset: location.offset,
    length: location.length,
  });
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(payload)}\n`, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, sidecar);
    try { fs.chmodSync(sidecar, 0o600); } catch { /* cache is still bound to the immutable archive stat */ }
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* preserve canonical archive */ }
    throw error;
  }
}

function removeLatestIdentitySidecar(filename: string): void {
  try { fs.rmSync(latestIdentitySidecarPath(filename), { force: true }); } catch { /* stale cache is ignored by archive key */ }
}

function runLatestIdentityWorker(filename: string): Promise<ResearchRunReplaySnapshotIdentity | undefined> {
  const workerPath = path.join(__dirname, "researchRunReplaySnapshotLatestWorker.js");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath, filename], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let overflow = false;
    const maxBytes = 16 * 1024;
    const enforceLimit = (): void => {
      if (Buffer.byteLength(stdout, "utf8") + Buffer.byteLength(stderr, "utf8") <= maxBytes || overflow) return;
      overflow = true;
      child.kill("SIGTERM");
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; enforceLimit(); });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; enforceLimit(); });
    child.once("error", () => reject(new Error("research replay snapshot latest worker failed closed")));
    child.once("close", (status) => {
      if (overflow || status !== 0) { reject(new Error("research replay snapshot latest worker failed closed")); return; }
      let parsed: unknown;
      try { parsed = JSON.parse(stdout.trim()); } catch { reject(new Error("research replay snapshot latest worker response is invalid")); return; }
      if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) { reject(new Error("research replay snapshot latest worker response is invalid")); return; }
      const value = parsed as Record<string, unknown>;
      if (value.status === "NONE") { resolve(undefined); return; }
      const fingerprint = typeof value.originalRunFingerprintSha256 === "string" ? value.originalRunFingerprintSha256.trim().toLowerCase() : "";
      const generatedAt = typeof value.generatedAt === "string" ? value.generatedAt.trim() : "";
      const timestamp = Date.parse(generatedAt);
      if (value.status !== "FOUND" || !SHA64.test(fingerprint) || !generatedAt || !Number.isSafeInteger(timestamp) || timestamp < 0) {
        reject(new Error("research replay snapshot latest worker response is invalid"));
        return;
      }
      resolve(Object.freeze({ originalRunFingerprintSha256: fingerprint, generatedAt }));
    });
  });
}

function ensureLegacyRollbackGuard(filename: string): void {
  if (!fs.existsSync(filename) || segmentNames(filename).length === 0) return;
  const archiveStat = fs.statSync(filename);
  if (!archiveStat.isFile()) throw new Error("research replay snapshot path is not a file");
  const archiveKey = archiveIdentityKey(archiveStat);
  const sidecar = latestIdentitySidecarPath(filename);
  if (fs.existsSync(sidecar)) {
    try {
      const existing = JSON.parse(fs.readFileSync(sidecar, "utf8")) as Record<string, unknown>;
      if (existing.archiveKey === archiveKey && existing.migrationGuard === LEGACY_SEGMENTED_MIGRATION_GUARD) return;
    } catch { /* non-authoritative legacy cache is replaced by the fail-closed guard */ }
  }
  const temporary = `${sidecar}.${process.pid}.tmp`;
  const payload = Object.freeze({
    schemaVersion: 1,
    archiveKey,
    originalRunFingerprintSha256: LEGACY_SEGMENTED_MIGRATION_GUARD,
    generatedAt: "1970-01-01T00:00:00.000Z",
    snapshotSha256: LEGACY_SEGMENTED_MIGRATION_GUARD,
    offset: 0,
    length: 0,
    migrationGuard: LEGACY_SEGMENTED_MIGRATION_GUARD,
  });
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(payload)}\n`, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, sidecar);
    try { fs.chmodSync(sidecar, 0o600); } catch { /* guard validity is archive-key bound */ }
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* preserve immutable evidence */ }
    throw error;
  }
}

function catalogSidecarPath(filename: string): string {
  return `${filename}${CATALOG_SIDECAR_SUFFIX}`;
}

function segmentDirectoryPath(filename: string): string {
  return `${filename}${SEGMENT_DIRECTORY_SUFFIX}`;
}

function currentArchiveKey(filename: string): string {
  if (!fs.existsSync(filename)) return "absent";
  const stat = fs.statSync(filename);
  if (!stat.isFile()) throw new Error("research replay snapshot path is not a file");
  return archiveIdentityKey(stat);
}

function segmentFilename(fingerprint: string): string {
  return `${fingerprint}.json`;
}

function segmentNames(filename: string): readonly string[] {
  const directory = segmentDirectoryPath(filename);
  if (!fs.existsSync(directory)) return Object.freeze([]);
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("research replay snapshot segment path is invalid");
  const names = fs.readdirSync(directory).filter((name) => /^[0-9a-f]{64}\.json$/.test(name)).sort();
  return Object.freeze(names);
}

function catalogEntry(
  snapshot: ResearchRunReplaySnapshot,
  source: "archive" | "segment",
  location?: ResearchRunReplaySnapshotLocation,
  segmentFile?: string,
  segmentKey?: string,
): ResearchRunReplaySnapshotCatalogEntry {
  const generatedAt = snapshot.options.generatedAt;
  const generatedAtMs = snapshotGeneratedAt(snapshot);
  if (typeof generatedAt !== "string" || !generatedAt.trim()) throw new Error("initial PAPER bootstrap Research generatedAt is unavailable");
  return Object.freeze({
    source,
    originalRunFingerprintSha256: snapshot.originalRunFingerprintSha256,
    generatedAt,
    generatedAtMs,
    snapshotSha256: snapshot.snapshotSha256,
    ...(location == null ? {} : { offset: location.offset, length: location.length }),
    ...(segmentFile == null ? {} : { segmentFile, segmentKey }),
  });
}

function writeCatalog(filename: string, entries: readonly ResearchRunReplaySnapshotCatalogEntry[]): void {
  const sidecar = catalogSidecarPath(filename);
  const directory = path.dirname(path.resolve(sidecar));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${sidecar}.${process.pid}.tmp`;
  const payload: ResearchRunReplaySnapshotCatalog = Object.freeze({
    schemaVersion: 1,
    archiveKey: currentArchiveKey(filename),
    entries: Object.freeze([...entries]),
  });
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(payload)}\n`, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, sidecar);
    try { fs.chmodSync(sidecar, 0o600); } catch { /* cache remains checksum/stat bound */ }
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* preserve immutable evidence */ }
    throw error;
  }
}

function readCatalog(filename: string): ResearchRunReplaySnapshotCatalog | undefined {
  const sidecar = catalogSidecarPath(filename);
  if (!fs.existsSync(sidecar)) return undefined;
  let parsed: ResearchRunReplaySnapshotCatalog;
  try { parsed = JSON.parse(fs.readFileSync(sidecar, "utf8")) as ResearchRunReplaySnapshotCatalog; }
  catch { throw new Error("research replay snapshot catalog is corrupted"); }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)) {
    throw new Error("research replay snapshot catalog is invalid");
  }
  const archiveKey = currentArchiveKey(filename);
  if (parsed.archiveKey !== archiveKey) return undefined;

  const fingerprints = new Set<string>();
  const expectedSegments: string[] = [];
  const entries: ResearchRunReplaySnapshotCatalogEntry[] = [];
  for (const raw of parsed.entries) {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("research replay snapshot catalog is invalid");
    const fingerprint = typeof raw.originalRunFingerprintSha256 === "string" ? raw.originalRunFingerprintSha256.trim().toLowerCase() : "";
    const generatedAt = typeof raw.generatedAt === "string" ? raw.generatedAt.trim() : "";
    const generatedAtMs = Date.parse(generatedAt);
    if (
      !SHA64.test(fingerprint)
      || fingerprints.has(fingerprint)
      || !SHA64.test(raw.snapshotSha256)
      || !generatedAt
      || !Number.isSafeInteger(generatedAtMs)
      || generatedAtMs < 0
      || raw.generatedAtMs !== generatedAtMs
      || (raw.source !== "archive" && raw.source !== "segment")
    ) throw new Error("research replay snapshot catalog is invalid");
    fingerprints.add(fingerprint);

    if (raw.source === "archive") {
      if (
        !fs.existsSync(filename)
        || !Number.isSafeInteger(raw.offset)
        || raw.offset! < CANONICAL_ARCHIVE_PREFIX.length
        || !Number.isSafeInteger(raw.length)
        || raw.length! <= 0
        || raw.offset! + raw.length! > fs.statSync(filename).size
        || raw.segmentFile != null
        || raw.segmentKey != null
      ) throw new Error("research replay snapshot catalog is invalid");
      entries.push(Object.freeze({
        source: "archive",
        originalRunFingerprintSha256: fingerprint,
        generatedAt,
        generatedAtMs,
        snapshotSha256: raw.snapshotSha256,
        offset: raw.offset,
        length: raw.length,
      }));
      continue;
    }

    const expectedFile = segmentFilename(fingerprint);
    if (raw.segmentFile !== expectedFile || typeof raw.segmentKey !== "string" || !raw.segmentKey) {
      throw new Error("research replay snapshot catalog is invalid");
    }
    const segmentPath = path.join(segmentDirectoryPath(filename), expectedFile);
    if (!fs.existsSync(segmentPath)) return undefined;
    const segmentStat = fs.lstatSync(segmentPath);
    if (!segmentStat.isFile() || segmentStat.isSymbolicLink()) throw new Error("research replay snapshot segment is invalid");
    if (archiveIdentityKey(segmentStat) !== raw.segmentKey) return undefined;
    expectedSegments.push(expectedFile);
    entries.push(Object.freeze({
      source: "segment",
      originalRunFingerprintSha256: fingerprint,
      generatedAt,
      generatedAtMs,
      snapshotSha256: raw.snapshotSha256,
      segmentFile: expectedFile,
      segmentKey: raw.segmentKey,
    }));
  }

  const actualSegments = [...segmentNames(filename)];
  if (expectedSegments.sort().join("\n") !== actualSegments.join("\n")) return undefined;
  return Object.freeze({ schemaVersion: 1, archiveKey, entries: Object.freeze(entries) });
}

function assertEntryMatchesSnapshot(entry: ResearchRunReplaySnapshotCatalogEntry, snapshot: ResearchRunReplaySnapshot): ResearchRunReplaySnapshot {
  if (
    snapshot.originalRunFingerprintSha256 !== entry.originalRunFingerprintSha256
    || snapshot.snapshotSha256 !== entry.snapshotSha256
    || snapshot.options.generatedAt !== entry.generatedAt
    || snapshotGeneratedAt(snapshot) !== entry.generatedAtMs
  ) throw new Error("research replay snapshot catalog provenance mismatch");
  return snapshot;
}

function readCatalogEntry(filename: string, entry: ResearchRunReplaySnapshotCatalogEntry, semantic = true): ResearchRunReplaySnapshot {
  let encoded: Buffer;
  if (entry.source === "archive") {
    if (!Number.isSafeInteger(entry.offset) || !Number.isSafeInteger(entry.length) || entry.offset! < 0 || entry.length! <= 0) {
      throw new Error("research replay snapshot catalog is invalid");
    }
    const fd = fs.openSync(filename, "r");
    try {
      encoded = Buffer.alloc(entry.length!);
      if (fs.readSync(fd, encoded, 0, encoded.length, entry.offset!) !== encoded.length) {
        throw new Error("research replay snapshot catalog points outside the archive");
      }
    } finally { fs.closeSync(fd); }
  } else {
    if (entry.segmentFile !== segmentFilename(entry.originalRunFingerprintSha256)) throw new Error("research replay snapshot catalog is invalid");
    encoded = fs.readFileSync(path.join(segmentDirectoryPath(filename), entry.segmentFile));
  }
  const snapshot = parseIntegrityValidatedSnapshot(encoded);
  assertEntryMatchesSnapshot(entry, snapshot);
  return semantic ? validate(snapshot) : snapshot;
}

function buildCatalog(filename: string): ResearchRunReplaySnapshotCatalog {
  const entries: ResearchRunReplaySnapshotCatalogEntry[] = [];
  const fingerprints = new Set<string>();
  forEachValidatedSnapshot(filename, (snapshot, _encoded, location) => {
    if (fingerprints.has(snapshot.originalRunFingerprintSha256)) throw new Error("research replay snapshot run identity is duplicated or invalid");
    fingerprints.add(snapshot.originalRunFingerprintSha256);
    entries.push(catalogEntry(snapshot, "archive", location));
  }, true);

  const directory = segmentDirectoryPath(filename);
  for (const name of segmentNames(filename)) {
    const segmentPath = path.join(directory, name);
    const snapshot = parseIntegrityValidatedSnapshot(fs.readFileSync(segmentPath));
    if (name !== segmentFilename(snapshot.originalRunFingerprintSha256) || fingerprints.has(snapshot.originalRunFingerprintSha256)) {
      throw new Error("research replay snapshot run identity is duplicated or invalid");
    }
    fingerprints.add(snapshot.originalRunFingerprintSha256);
    const stat = fs.lstatSync(segmentPath);
    entries.push(catalogEntry(snapshot, "segment", undefined, name, archiveIdentityKey(stat)));
  }
  writeCatalog(filename, entries);
  return Object.freeze({ schemaVersion: 1, archiveKey: currentArchiveKey(filename), entries: Object.freeze(entries) });
}

function ensureCatalog(filename: string): ResearchRunReplaySnapshotCatalog {
  const cached = readCatalog(filename);
  const catalog = cached ?? buildCatalog(filename);
  if (catalog.entries.some((entry) => entry.source === "segment")) ensureLegacyRollbackGuard(filename);
  return catalog;
}

function latestCatalogEntry(catalog: ResearchRunReplaySnapshotCatalog): ResearchRunReplaySnapshotCatalogEntry | undefined {
  let latest: ResearchRunReplaySnapshotCatalogEntry | undefined;
  let latestGeneratedAt = -1;
  let latestTimestampCount = 0;
  for (const entry of catalog.entries) {
    if (entry.generatedAtMs > latestGeneratedAt) {
      latestGeneratedAt = entry.generatedAtMs;
      latestTimestampCount = 1;
      latest = entry;
    } else if (entry.generatedAtMs === latestGeneratedAt) {
      latestTimestampCount += 1;
    }
  }
  if (latest == null) return undefined;
  if (latestTimestampCount !== 1) throw new Error("initial PAPER bootstrap latest Research snapshot is ambiguous");
  return latest;
}

function catalogStateKey(filename: string): string {
  const archiveKey = currentArchiveKey(filename);
  const directory = segmentDirectoryPath(filename);
  if (!fs.existsSync(directory)) return `${archiveKey}:segments:absent`;
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("research replay snapshot segment path is invalid");
  return `${archiveKey}:segments:${archiveIdentityKey(stat)}:${segmentNames(filename).length}`;
}

function writeFirstArchiveSnapshot(filename: string, snapshot: ResearchRunReplaySnapshot): ResearchRunReplaySnapshotCatalog {
  const directory = path.dirname(path.resolve(filename));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${process.pid}.tmp`;
  const encoded = Buffer.from(JSON.stringify(snapshot), "utf8");
  try {
    fs.writeFileSync(temporary, Buffer.concat([CANONICAL_ARCHIVE_PREFIX, encoded, Buffer.from("]}\n")]), { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, filename);
    try { fs.chmodSync(filename, 0o600); } catch { /* checksum/provenance remains authoritative */ }
    const location = Object.freeze({ offset: CANONICAL_ARCHIVE_PREFIX.length, length: encoded.length });
    const entry = catalogEntry(snapshot, "archive", location);
    writeCatalog(filename, [entry]);
    try { writeLatestIdentitySidecar(filename, snapshot, location); } catch { removeLatestIdentitySidecar(filename); }
    return Object.freeze({ schemaVersion: 1, archiveKey: currentArchiveKey(filename), entries: Object.freeze([entry]) });
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* preserve durable source */ }
    throw error;
  }
}

function writeSegment(filename: string, snapshot: ResearchRunReplaySnapshot): ResearchRunReplaySnapshotCatalogEntry {
  const directory = segmentDirectoryPath(filename);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const name = segmentFilename(snapshot.originalRunFingerprintSha256);
  const target = path.join(directory, name);
  if (fs.existsSync(target)) throw new Error("research replay snapshot segment already exists outside the validated catalog");
  const temporary = path.join(directory, `.${name}.${process.pid}.tmp`);
  const encoded = Buffer.from(JSON.stringify(snapshot), "utf8");
  try {
    const fd = fs.openSync(temporary, "wx", 0o600);
    try {
      if (fs.writeSync(fd, encoded, 0, encoded.length, 0) !== encoded.length) throw new Error("research replay snapshot segment write was incomplete");
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, target);
    try { fs.chmodSync(target, 0o600); } catch { /* checksum/provenance remains authoritative */ }
    const stat = fs.lstatSync(target);
    return catalogEntry(snapshot, "segment", undefined, name, archiveIdentityKey(stat));
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* preserve any committed segment for recovery */ }
    throw error;
  }
}

export interface ResearchRunReplaySnapshotReader {
  read(originalRunFingerprintSha256: string): ResearchRunReplaySnapshot | undefined;
  latest(): ResearchRunReplaySnapshot | undefined;
  latestIdentityAsync?(): Promise<ResearchRunReplaySnapshotIdentity | undefined>;
  list(): readonly ResearchRunReplaySnapshot[];
}

export interface ResearchRunReplaySnapshotWriter {
  save(snapshot: ResearchRunReplaySnapshot): ResearchRunReplaySnapshot;
}

/**
 * Append-only durable archive of immutable original Research runs. Longitudinal PAPER validation
 * can outlive later Research cycles, so a newer run must never overwrite the original candidate/
 * dataset snapshot of an active or historical challenger. Exact replays are idempotent; mutation
 * of an existing run fingerprint fails closed. Writes are atomic and owner-only where supported.
 */
export class FileResearchRunReplaySnapshotStore implements ResearchRunReplaySnapshotReader, ResearchRunReplaySnapshotWriter {
  private latestIdentityCache: { readonly key: string; readonly identity: ResearchRunReplaySnapshotIdentity | undefined } | undefined;
  private latestIdentityPending: { readonly key: string; readonly promise: Promise<ResearchRunReplaySnapshotIdentity | undefined> } | undefined;

  public constructor(private readonly filename: string) {
    if (!filename.trim() || filename === ":memory:") throw new Error("research replay snapshot path must be durable");
  }

  private readFile(): ResearchRunReplaySnapshotFile {
    const snapshots: ResearchRunReplaySnapshot[] = [];
    if (fs.existsSync(this.filename)) {
      const stat = fs.statSync(this.filename);
      if (!stat.isFile()) throw new Error("research replay snapshot path is not a file");
      let parsed: ResearchRunReplaySnapshotFile;
      try { parsed = JSON.parse(fs.readFileSync(this.filename, "utf8")) as ResearchRunReplaySnapshotFile; }
      catch { throw new Error("research replay snapshot file is corrupted"); }
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.snapshots)) throw new Error("research replay snapshot file schema is invalid");
      snapshots.push(...parsed.snapshots.map((snapshot) => validate(snapshot)));
    }
    const fingerprints = new Set<string>();
    for (const snapshot of snapshots) {
      if (!SHA64.test(snapshot.originalRunFingerprintSha256) || fingerprints.has(snapshot.originalRunFingerprintSha256)) {
        throw new Error("research replay snapshot run identity is duplicated or invalid");
      }
      fingerprints.add(snapshot.originalRunFingerprintSha256);
    }
    for (const name of segmentNames(this.filename)) {
      const snapshot = validate(parseIntegrityValidatedSnapshot(fs.readFileSync(path.join(segmentDirectoryPath(this.filename), name))));
      if (name !== segmentFilename(snapshot.originalRunFingerprintSha256) || fingerprints.has(snapshot.originalRunFingerprintSha256)) {
        throw new Error("research replay snapshot run identity is duplicated or invalid");
      }
      fingerprints.add(snapshot.originalRunFingerprintSha256);
      snapshots.push(snapshot);
    }
    return Object.freeze({ schemaVersion: 1, snapshots: Object.freeze(snapshots) });
  }

  public read(originalRunFingerprintSha256: string): ResearchRunReplaySnapshot | undefined {
    const fingerprint = originalRunFingerprintSha256.trim().toLowerCase();
    if (!SHA64.test(fingerprint)) throw new Error("research replay snapshot run fingerprint is invalid");
    const catalog = ensureCatalog(this.filename);
    const entry = catalog.entries.find((candidate) => candidate.originalRunFingerprintSha256 === fingerprint);
    return entry == null ? undefined : readCatalogEntry(this.filename, entry, true);
  }

  /** Selects the unique newest immutable Research snapshot across the legacy base and segments. */
  public latest(): ResearchRunReplaySnapshot | undefined {
    const entry = latestCatalogEntry(ensureCatalog(this.filename));
    return entry == null ? undefined : readCatalogEntry(this.filename, entry, true);
  }

  /**
   * Selects the newest checksum-bound identity from a stat-bound catalog. The catalog is only a
   * cache: any base/segment stat drift invalidates it and forces a full integrity rebuild.
   */
  public latestIdentity(): ResearchRunReplaySnapshotIdentity | undefined {
    const entry = latestCatalogEntry(ensureCatalog(this.filename));
    if (entry == null) return undefined;
    return Object.freeze({ originalRunFingerprintSha256: entry.originalRunFingerprintSha256, generatedAt: entry.generatedAt });
  }

  /**
   * Production bootstrap path. A valid small catalog is O(1). First migration/recovery rebuilds the
   * catalog in the existing isolated worker so a legacy hundreds-of-MiB scan cannot starve health.
   */
  public latestIdentityAsync(): Promise<ResearchRunReplaySnapshotIdentity | undefined> {
    const names = segmentNames(this.filename);
    if (!fs.existsSync(this.filename) && names.length === 0) {
      this.latestIdentityCache = Object.freeze({ key: "absent", identity: undefined });
      return Promise.resolve(undefined);
    }
    let catalog: ResearchRunReplaySnapshotCatalog | undefined;
    try { catalog = readCatalog(this.filename); }
    catch (error) { return Promise.reject(error); }
    if (catalog != null) {
      if (catalog.entries.some((entry) => entry.source === "segment")) ensureLegacyRollbackGuard(this.filename);
      const entry = latestCatalogEntry(catalog);
      const identity = entry == null ? undefined : Object.freeze({
        originalRunFingerprintSha256: entry.originalRunFingerprintSha256,
        generatedAt: entry.generatedAt,
      });
      const key = catalogStateKey(this.filename);
      this.latestIdentityCache = Object.freeze({ key, identity });
      return Promise.resolve(identity);
    }

    let key: string;
    try { key = catalogStateKey(this.filename); }
    catch (error) { return Promise.reject(error); }
    if (this.latestIdentityCache?.key === key) return Promise.resolve(this.latestIdentityCache.identity);
    if (this.latestIdentityPending?.key === key) return this.latestIdentityPending.promise;
    const promise = runLatestIdentityWorker(this.filename).then((identity) => {
      this.latestIdentityCache = Object.freeze({ key: catalogStateKey(this.filename), identity });
      return identity;
    }).finally(() => {
      if (this.latestIdentityPending?.key === key) this.latestIdentityPending = undefined;
    });
    this.latestIdentityPending = Object.freeze({ key, promise });
    return promise;
  }

  public list(): readonly ResearchRunReplaySnapshot[] {
    return Object.freeze([...this.readFile().snapshots]);
  }

  public save(snapshot: ResearchRunReplaySnapshot): ResearchRunReplaySnapshot {
    const next = validate(snapshot);
    const currentSegments = segmentNames(this.filename);
    if (!fs.existsSync(this.filename) && currentSegments.length === 0) {
      writeFirstArchiveSnapshot(this.filename, next);
      this.latestIdentityCache = undefined;
      this.latestIdentityPending = undefined;
      return next;
    }

    const catalog = ensureCatalog(this.filename);
    const existing = catalog.entries.find((entry) => entry.originalRunFingerprintSha256 === next.originalRunFingerprintSha256);
    if (existing != null) {
      if (existing.snapshotSha256 !== next.snapshotSha256) throw new Error("research replay snapshot immutable run identity conflict");
      return readCatalogEntry(this.filename, existing, true);
    }

    const segment = writeSegment(this.filename, next);
    // Once a committed segment exists, an older single-file reader must never silently treat the
    // frozen legacy base as current. Publish the archive-key-bound downgrade guard before catalog
    // publication so a crash in the metadata handoff still fails closed under an old binary.
    ensureLegacyRollbackGuard(this.filename);
    try {
      writeCatalog(this.filename, [...catalog.entries, segment]);
    } catch (error) {
      // The segment is already immutable and checksum-bound. Keep it so a retry can rebuild the
      // catalog and resolve the exact replay idempotently instead of losing committed evidence.
      this.latestIdentityCache = undefined;
      this.latestIdentityPending = undefined;
      throw error;
    }
    this.latestIdentityCache = undefined;
    this.latestIdentityPending = undefined;
    return next;
  }

}
