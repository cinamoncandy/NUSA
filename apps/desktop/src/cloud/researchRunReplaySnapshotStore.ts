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

function readLatestIdentitySidecar(filename: string): ResearchRunReplaySnapshotLatestIdentitySidecar | undefined {
  if (!fs.existsSync(filename)) return undefined;
  const archiveStat = fs.statSync(filename);
  if (!archiveStat.isFile()) throw new Error("research replay snapshot path is not a file");
  const sidecar = latestIdentitySidecarPath(filename);
  if (!fs.existsSync(sidecar)) return undefined;
  let parsed: ResearchRunReplaySnapshotLatestIdentitySidecar;
  try { parsed = JSON.parse(fs.readFileSync(sidecar, "utf8")) as ResearchRunReplaySnapshotLatestIdentitySidecar; }
  catch { throw new Error("research replay snapshot latest identity sidecar is corrupted"); }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("research replay snapshot latest identity sidecar is corrupted");
  }
  const generatedAt = typeof parsed.generatedAt === "string" ? parsed.generatedAt.trim() : "";
  const timestamp = Date.parse(generatedAt);
  if (
    parsed.schemaVersion !== 1
    || parsed.archiveKey !== archiveIdentityKey(archiveStat)
    || !SHA64.test(parsed.originalRunFingerprintSha256)
    || !SHA64.test(parsed.snapshotSha256)
    || !generatedAt
    || !Number.isSafeInteger(timestamp)
    || timestamp < 0
    || !Number.isSafeInteger(parsed.offset)
    || parsed.offset < CANONICAL_ARCHIVE_PREFIX.length
    || !Number.isSafeInteger(parsed.length)
    || parsed.length <= 0
    || parsed.offset + parsed.length > archiveStat.size
  ) {
    // A stat mismatch means the archive changed after this cache was committed. Ignore that stale
    // cache and fall back to the canonical scan. A cache claiming the current archive must be valid.
    if (parsed?.archiveKey !== archiveIdentityKey(archiveStat)) return undefined;
    throw new Error("research replay snapshot latest identity sidecar is invalid");
  }
  return Object.freeze({
    schemaVersion: 1,
    archiveKey: parsed.archiveKey,
    originalRunFingerprintSha256: parsed.originalRunFingerprintSha256,
    generatedAt,
    snapshotSha256: parsed.snapshotSha256,
    offset: parsed.offset,
    length: parsed.length,
  });
}

function readSnapshotAtSidecar(filename: string, sidecar: ResearchRunReplaySnapshotLatestIdentitySidecar): ResearchRunReplaySnapshot {
  const fd = fs.openSync(filename, "r");
  try {
    const encoded = Buffer.alloc(sidecar.length);
    if (fs.readSync(fd, encoded, 0, encoded.length, sidecar.offset) !== encoded.length) {
      throw new Error("research replay snapshot latest identity sidecar points outside the archive");
    }
    const snapshot = parseIntegrityValidatedSnapshot(encoded);
    if (
      snapshot.originalRunFingerprintSha256 !== sidecar.originalRunFingerprintSha256
      || snapshot.options.generatedAt !== sidecar.generatedAt
      || snapshot.snapshotSha256 !== sidecar.snapshotSha256
    ) throw new Error("research replay snapshot latest identity sidecar provenance mismatch");
    return snapshot;
  } finally {
    fs.closeSync(fd);
  }
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
    if (!fs.existsSync(this.filename)) return Object.freeze({ schemaVersion: 1, snapshots: Object.freeze([]) });
    const stat = fs.statSync(this.filename);
    if (!stat.isFile()) throw new Error("research replay snapshot path is not a file");
    let parsed: ResearchRunReplaySnapshotFile;
    try { parsed = JSON.parse(fs.readFileSync(this.filename, "utf8")) as ResearchRunReplaySnapshotFile; }
    catch { throw new Error("research replay snapshot file is corrupted"); }
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.snapshots)) throw new Error("research replay snapshot file schema is invalid");
    const fingerprints = new Set<string>();
    const snapshots = parsed.snapshots.map((snapshot) => {
      const checked = validate(snapshot);
      if (!SHA64.test(checked.originalRunFingerprintSha256) || fingerprints.has(checked.originalRunFingerprintSha256)) {
        throw new Error("research replay snapshot run identity is duplicated or invalid");
      }
      fingerprints.add(checked.originalRunFingerprintSha256);
      return checked;
    });
    return Object.freeze({ schemaVersion: 1, snapshots: Object.freeze(snapshots) });
  }

  public read(originalRunFingerprintSha256: string): ResearchRunReplaySnapshot | undefined {
    const fingerprint = originalRunFingerprintSha256.trim().toLowerCase();
    if (!SHA64.test(fingerprint)) throw new Error("research replay snapshot run fingerprint is invalid");
    const sidecar = readLatestIdentitySidecar(this.filename);
    if (sidecar?.originalRunFingerprintSha256 === fingerprint) return validate(readSnapshotAtSidecar(this.filename, sidecar));
    let found: ResearchRunReplaySnapshot | undefined;
    forEachValidatedSnapshot(this.filename, (snapshot) => {
      if (snapshot.originalRunFingerprintSha256 === fingerprint) found = validate(snapshot);
    }, true);
    return found;
  }

  /**
   * Selects the unique newest immutable Research snapshot without materializing the archive.
   * Every entry is still parsed, provenance/checksum validated, and duplicate-identity checked.
   * Only the current newest raw JSON buffer is retained while scanning, so historical archive
   * growth does not multiply V8 heap usage in the production bootstrap process.
   */
  public latest(): ResearchRunReplaySnapshot | undefined {
    let latestEncoded: Buffer | undefined;
    let latestGeneratedAt = -1;
    let latestTimestampCount = 0;
    forEachValidatedSnapshot(this.filename, (snapshot, encoded) => {
      const generatedAt = snapshotGeneratedAt(snapshot);
      if (generatedAt > latestGeneratedAt) {
        latestGeneratedAt = generatedAt;
        latestTimestampCount = 1;
        latestEncoded = encoded;
      } else if (generatedAt === latestGeneratedAt) {
        latestTimestampCount += 1;
      }
    });
    if (latestEncoded == null) return undefined;
    if (latestTimestampCount !== 1) throw new Error("initial PAPER bootstrap latest Research snapshot is ambiguous");
    let parsed: ResearchRunReplaySnapshot;
    try { parsed = JSON.parse(latestEncoded.toString("utf8")) as ResearchRunReplaySnapshot; }
    catch { throw new Error("research replay snapshot file is corrupted"); }
    return parsed;
  }

  /**
   * Selects the newest checksum-bound archive identity without re-running every historical League.
   * Full semantic replay remains mandatory when the selected fingerprint is read for Research and
   * before its candidate can acquire PAPER_RESEARCH_ONLY authority.
   */
  public latestIdentity(): ResearchRunReplaySnapshotIdentity | undefined {
    const cached = readLatestIdentitySidecar(this.filename);
    if (cached != null) return Object.freeze({
      originalRunFingerprintSha256: cached.originalRunFingerprintSha256,
      generatedAt: cached.generatedAt,
    });
    let latestSnapshot: ResearchRunReplaySnapshot | undefined;
    let latestLocation: ResearchRunReplaySnapshotLocation | undefined;
    let latestGeneratedAt = -1;
    let latestTimestampCount = 0;
    forEachValidatedSnapshot(this.filename, (snapshot, _encoded, location) => {
      const generatedAt = snapshotGeneratedAt(snapshot);
      if (generatedAt > latestGeneratedAt) {
        latestGeneratedAt = generatedAt;
        latestTimestampCount = 1;
        latestSnapshot = snapshot;
        latestLocation = location;
      } else if (generatedAt === latestGeneratedAt) {
        latestTimestampCount += 1;
      }
    }, true);
    if (latestSnapshot == null || latestLocation == null) return undefined;
    if (latestTimestampCount !== 1) {
      removeLatestIdentitySidecar(this.filename);
      throw new Error("initial PAPER bootstrap latest Research snapshot is ambiguous");
    }
    // One legacy scan seeds an owner-only stat-bound cache. Future bootstrap cycles are O(1); the
    // selected snapshot still receives full semantic replay in read(). Cache failure is not an
    // archive failure, so leave the immutable source untouched and fall back next time.
    try { writeLatestIdentitySidecar(this.filename, latestSnapshot, latestLocation); } catch { removeLatestIdentitySidecar(this.filename); }
    return Object.freeze({
      originalRunFingerprintSha256: latestSnapshot.originalRunFingerprintSha256,
      generatedAt: latestSnapshot.options.generatedAt!,
    });
  }

  /**
   * Production bootstrap path. The full immutable archive envelope is validated in a separate Node
   * process so synchronous canonical replay checks never starve /health, /ready, or mobile
   * enrollment. Historical League semantics are not re-executed during identity discovery; the
   * selected fingerprint still passes the existing full replay boundary before deployment.
   */
  public latestIdentityAsync(): Promise<ResearchRunReplaySnapshotIdentity | undefined> {
    if (!fs.existsSync(this.filename)) {
      this.latestIdentityCache = Object.freeze({ key: "absent", identity: undefined });
      return Promise.resolve(undefined);
    }
    const stat = fs.statSync(this.filename);
    if (!stat.isFile()) return Promise.reject(new Error("research replay snapshot path is not a file"));
    const sidecar = readLatestIdentitySidecar(this.filename);
    const key = archiveIdentityKey(stat);
    if (sidecar != null) {
      const identity = Object.freeze({
        originalRunFingerprintSha256: sidecar.originalRunFingerprintSha256,
        generatedAt: sidecar.generatedAt,
      });
      this.latestIdentityCache = Object.freeze({ key, identity });
      return Promise.resolve(identity);
    }
    if (this.latestIdentityCache?.key === key) return Promise.resolve(this.latestIdentityCache.identity);
    if (this.latestIdentityPending?.key === key) return this.latestIdentityPending.promise;
    const promise = runLatestIdentityWorker(this.filename).then((identity) => {
      this.latestIdentityCache = Object.freeze({ key, identity });
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
    let existing: ResearchRunReplaySnapshot | undefined;
    let existingCount = 0;
    let latestSnapshot: ResearchRunReplaySnapshot | undefined;
    let latestLocation: ResearchRunReplaySnapshotLocation | undefined;
    let latestGeneratedAt = -1;
    let latestTimestampCount = 0;

    // The production archive contains full walk-forward evidence and is already hundreds of MiB.
    // Never materialize or semantically replay every historical snapshot on a write. Scan one
    // immutable envelope at a time, checksum/provenance-validate it, and replay only an exact
    // duplicate identity before returning it. The new snapshot above still receives the full
    // semantic replay validation before any byte is written.
    if (fs.existsSync(this.filename)) {
      forEachValidatedSnapshot(this.filename, (entry, _encoded, location) => {
        existingCount += 1;
        const generatedAt = snapshotGeneratedAt(entry);
        if (generatedAt > latestGeneratedAt) {
          latestGeneratedAt = generatedAt;
          latestTimestampCount = 1;
          latestSnapshot = entry;
          latestLocation = location;
        } else if (generatedAt === latestGeneratedAt) {
          latestTimestampCount += 1;
        }
        if (entry.originalRunFingerprintSha256 !== next.originalRunFingerprintSha256) return;
        if (entry.snapshotSha256 !== next.snapshotSha256) {
          throw new Error("research replay snapshot immutable run identity conflict");
        }
        existing = validate(entry);
      }, true);
    }
    if (existing != null) {
      if (latestSnapshot != null && latestLocation != null && latestTimestampCount === 1) {
        try { writeLatestIdentitySidecar(this.filename, latestSnapshot, latestLocation); } catch { removeLatestIdentitySidecar(this.filename); }
      }
      return existing;
    }

    const directory = path.dirname(path.resolve(this.filename));
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.filename}.${process.pid}.tmp`;
    const encodedNext = Buffer.from(JSON.stringify(next), "utf8");
    let nextLocation: ResearchRunReplaySnapshotLocation | undefined;

    try {
      if (!fs.existsSync(this.filename)) {
        fs.writeFileSync(
          temporary,
          Buffer.concat([CANONICAL_ARCHIVE_PREFIX, encodedNext, Buffer.from("]}\n")]),
          { mode: 0o600, flag: "wx" },
        );
        nextLocation = Object.freeze({ offset: CANONICAL_ARCHIVE_PREFIX.length, length: encodedNext.length });
      } else {
        // Copy the already-validated archive first so every historical snapshot byte remains
        // immutable. Only the final array/object suffix is replaced in the temporary copy.
        fs.copyFileSync(this.filename, temporary, fs.constants.COPYFILE_EXCL);
        const fd = fs.openSync(temporary, "r+");
        try {
          const stat = fs.fstatSync(fd);
          const tailLength = Math.min(stat.size, STREAM_CHUNK_BYTES);
          const tail = Buffer.alloc(tailLength);
          if (fs.readSync(fd, tail, 0, tailLength, stat.size - tailLength) !== tailLength) {
            throw new Error("research replay snapshot file is corrupted");
          }
          let cursor = tail.length - 1;
          while (cursor >= 0 && isWhitespace(tail[cursor]!)) cursor -= 1;
          if (cursor < 0 || tail[cursor] !== 0x7d) throw new Error("research replay snapshot file is corrupted");
          cursor -= 1;
          while (cursor >= 0 && isWhitespace(tail[cursor]!)) cursor -= 1;
          if (cursor < 0 || tail[cursor] !== 0x5d) throw new Error("research replay snapshot file is corrupted");

          const arrayCloseOffset = stat.size - tailLength + cursor;
          fs.ftruncateSync(fd, arrayCloseOffset);
          const separatorLength = existingCount > 0 ? 1 : 0;
          nextLocation = Object.freeze({ offset: arrayCloseOffset + separatorLength, length: encodedNext.length });
          const suffix = Buffer.concat([
            Buffer.from(existingCount > 0 ? "," : ""),
            encodedNext,
            Buffer.from("]}\n"),
          ]);
          if (fs.writeSync(fd, suffix, 0, suffix.length, arrayCloseOffset) !== suffix.length) {
            throw new Error("research replay snapshot atomic append was incomplete");
          }
        } finally {
          fs.closeSync(fd);
        }
      }
      fs.renameSync(temporary, this.filename);
      this.latestIdentityCache = undefined;
      this.latestIdentityPending = undefined;
      try { fs.chmodSync(this.filename, 0o600); } catch { /* integrity remains checksum/provenance bound */ }

      const nextGeneratedAt = snapshotGeneratedAt(next);
      if (nextGeneratedAt > latestGeneratedAt) {
        latestGeneratedAt = nextGeneratedAt;
        latestTimestampCount = 1;
        latestSnapshot = next;
        latestLocation = nextLocation;
      } else if (nextGeneratedAt === latestGeneratedAt) {
        latestTimestampCount += 1;
      }
      if (latestSnapshot != null && latestLocation != null && latestTimestampCount === 1) {
        try { writeLatestIdentitySidecar(this.filename, latestSnapshot, latestLocation); } catch { removeLatestIdentitySidecar(this.filename); }
      } else {
        removeLatestIdentitySidecar(this.filename);
      }
      return next;
    } catch (error) {
      try { fs.rmSync(temporary, { force: true }); } catch { /* preserve original archive */ }
      throw error;
    }
  }
}
