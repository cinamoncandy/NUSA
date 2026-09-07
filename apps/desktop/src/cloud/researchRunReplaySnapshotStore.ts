import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  replayResearchRunWithPaperEvidence,
  type ResearchRunReplaySnapshot,
} from "./researchRunReplaySnapshot";

const FORBIDDEN_KEY = /(authorization|bearer|token|secret|password|api[_-]?key|access[_-]?key|private[_-]?key|cookie|jwt|credential)/i;
const SHA64 = /^[0-9a-f]{64}$/;
const CANONICAL_ARCHIVE_PREFIX = Buffer.from('{"schemaVersion":1,"snapshots":[');
const STREAM_CHUNK_BYTES = 64 * 1024;

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

function parseValidatedSnapshot(encoded: Buffer): ResearchRunReplaySnapshot {
  let parsed: ResearchRunReplaySnapshot;
  try { parsed = JSON.parse(encoded.toString("utf8")) as ResearchRunReplaySnapshot; }
  catch { throw new Error("research replay snapshot file is corrupted"); }
  return validate(parsed);
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
 * The scan still validates every archived snapshot and rejects duplicate identities; integrity and
 * denominator semantics are unchanged. Only the peak number of simultaneously retained snapshots
 * changes from the whole archive to one.
 */
function forEachValidatedSnapshot(filename: string, visit: (snapshot: ResearchRunReplaySnapshot, encoded: Buffer) => void): void {
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

    const finishObject = (): void => {
      const encoded = Buffer.concat(objectParts, objectBytes);
      const checked = parseValidatedSnapshot(encoded);
      if (!SHA64.test(checked.originalRunFingerprintSha256) || fingerprints.has(checked.originalRunFingerprintSha256)) {
        throw new Error("research replay snapshot run identity is duplicated or invalid");
      }
      fingerprints.add(checked.originalRunFingerprintSha256);
      visit(checked, encoded);
      objectParts = [];
      objectBytes = 0;
      started = false;
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
    let found: ResearchRunReplaySnapshot | undefined;
    forEachValidatedSnapshot(this.filename, (snapshot) => {
      if (snapshot.originalRunFingerprintSha256 === fingerprint) found = snapshot;
    });
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
   * Production bootstrap path. The full immutable archive is validated in a separate Node process
   * so synchronous canonical replay checks never starve /health, /ready, or mobile enrollment.
   * The small latest identity is cached only while the archive stat fingerprint is unchanged.
   */
  public latestIdentityAsync(): Promise<ResearchRunReplaySnapshotIdentity | undefined> {
    if (!fs.existsSync(this.filename)) {
      this.latestIdentityCache = Object.freeze({ key: "absent", identity: undefined });
      return Promise.resolve(undefined);
    }
    const stat = fs.statSync(this.filename);
    if (!stat.isFile()) return Promise.reject(new Error("research replay snapshot path is not a file"));
    const key = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
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
    const current = this.readFile();
    const existing = current.snapshots.find((entry) => entry.originalRunFingerprintSha256 === next.originalRunFingerprintSha256);
    if (existing != null) {
      if (existing.snapshotSha256 !== next.snapshotSha256) throw new Error("research replay snapshot immutable run identity conflict");
      return existing;
    }
    const snapshots = Object.freeze([...current.snapshots, next].sort((left, right) => left.originalRunFingerprintSha256.localeCompare(right.originalRunFingerprintSha256)));
    const payload: ResearchRunReplaySnapshotFile = Object.freeze({ schemaVersion: 1, snapshots });
    const directory = path.dirname(path.resolve(this.filename));
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.filename}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(payload)}\n`, { encoding: "utf8", mode: 0o600, flag: "w" });
    fs.renameSync(temporary, this.filename);
    try { fs.chmodSync(this.filename, 0o600); } catch { /* integrity remains checksum/provenance bound */ }
    return next;
  }
}
