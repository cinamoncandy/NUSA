import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  replayResearchRunWithPaperEvidence,
  validateResearchRunReplaySnapshotIntegrity,
  type ResearchRunReplaySnapshot,
} from "./researchRunReplaySnapshot";

const SHA64 = /^[0-9a-f]{64}$/;
const FORBIDDEN_KEY = /(authorization|bearer|token|secret|password|api[_-]?key|access[_-]?key|private[_-]?key|cookie|jwt|credential)/i;
const FORMAT = "NUSA_RESEARCH_REPLAY_OBJECT_CHAIN_V2" as const;
const ZERO_SHA256 = "0".repeat(64);
const STREAM_CHUNK_BYTES = 64 * 1024;
const CANONICAL_ARCHIVE_PREFIX = Buffer.from('{"schemaVersion":1,"snapshots":[');
const MIGRATION_SUFFIX = ".migration-v2";

interface ReplayRecordPayloadV2 {
  readonly schemaVersion: 2;
  readonly ordinal: number;
  readonly previousRecordSha256: string;
  readonly snapshot: ResearchRunReplaySnapshot;
}

interface ReplayRecordV2 extends ReplayRecordPayloadV2 {
  readonly recordSha256: string;
}

export interface ResearchRunReplaySnapshotIdentityV2 {
  readonly ordinal: number;
  readonly originalRunFingerprintSha256: string;
  readonly snapshotSha256: string;
  readonly generatedAt: string;
  readonly recordSha256: string;
}

interface ReplayHeadLatestV2 {
  readonly originalRunFingerprintSha256: string;
  readonly snapshotSha256: string;
  readonly generatedAt: string;
  readonly recordSha256: string;
}

interface ReplayHeadPayloadV2 {
  readonly schemaVersion: 2;
  readonly format: typeof FORMAT;
  readonly count: number;
  readonly chainHeadSha256: string;
  readonly latest: ReplayHeadLatestV2 | null;
  readonly latestTimestampCount: number;
}

interface ReplayHeadV2 extends ReplayHeadPayloadV2 {
  readonly headSha256: string;
}

interface MigrationMarkerPayloadV2 {
  readonly schemaVersion: 1;
  readonly legacySize: number;
  readonly legacyMtimeMs: number;
  readonly recordCount: number;
  readonly logicalReplaySha256: string;
}

interface MigrationMarkerV2 extends MigrationMarkerPayloadV2 {
  readonly markerSha256: string;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashJson(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function isSafeOrdinal(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function rejectForbidden(value: unknown, seen = new Set<object>()): void {
  if (value == null || typeof value !== "object") return;
  if (seen.has(value)) throw new Error("research replay v2 snapshot must be acyclic");
  seen.add(value);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error("research replay v2 snapshot contains a forbidden field");
    rejectForbidden(child, seen);
  }
  seen.delete(value);
}

function generatedAtOf(snapshot: ResearchRunReplaySnapshot): string {
  const generatedAt = snapshot.options.generatedAt;
  if (typeof generatedAt !== "string" || !generatedAt.trim()) {
    throw new Error("research replay v2 generatedAt is unavailable");
  }
  const timestamp = Date.parse(generatedAt);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error("research replay v2 generatedAt is invalid");
  }
  return generatedAt;
}

function validateSnapshotIntegrity(snapshot: ResearchRunReplaySnapshot): ResearchRunReplaySnapshot {
  rejectForbidden(snapshot);
  validateResearchRunReplaySnapshotIntegrity(snapshot);
  return snapshot;
}

function validateSnapshotSemantics(snapshot: ResearchRunReplaySnapshot): ResearchRunReplaySnapshot {
  validateSnapshotIntegrity(snapshot);
  replayResearchRunWithPaperEvidence(snapshot, Object.freeze({}));
  return snapshot;
}

function recordPayload(record: ReplayRecordV2): ReplayRecordPayloadV2 {
  return Object.freeze({
    schemaVersion: 2,
    ordinal: record.ordinal,
    previousRecordSha256: record.previousRecordSha256,
    snapshot: record.snapshot,
  });
}

function buildRecord(
  ordinal: number,
  previousRecordSha256: string,
  snapshot: ResearchRunReplaySnapshot,
): ReplayRecordV2 {
  if (!isSafeOrdinal(ordinal) || !SHA64.test(previousRecordSha256)) {
    throw new Error("research replay v2 record identity is invalid");
  }
  const payload: ReplayRecordPayloadV2 = Object.freeze({
    schemaVersion: 2,
    ordinal,
    previousRecordSha256,
    snapshot,
  });
  return Object.freeze({ ...payload, recordSha256: hashJson(payload) });
}

function validateRecord(value: unknown, expectedRecordSha256?: string): ReplayRecordV2 {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("research replay v2 record is corrupted");
  }
  const parsed = value as ReplayRecordV2;
  if (
    parsed.schemaVersion !== 2
    || !isSafeOrdinal(parsed.ordinal)
    || !SHA64.test(parsed.previousRecordSha256)
    || !SHA64.test(parsed.recordSha256)
    || (expectedRecordSha256 != null && parsed.recordSha256 !== expectedRecordSha256)
  ) {
    throw new Error("research replay v2 record identity is invalid");
  }
  validateSnapshotIntegrity(parsed.snapshot);
  if (hashJson(recordPayload(parsed)) !== parsed.recordSha256) {
    throw new Error("research replay v2 record checksum mismatch");
  }
  return Object.freeze({
    schemaVersion: 2,
    ordinal: parsed.ordinal,
    previousRecordSha256: parsed.previousRecordSha256,
    snapshot: parsed.snapshot,
    recordSha256: parsed.recordSha256,
  });
}

function emptyHeadPayload(): ReplayHeadPayloadV2 {
  return Object.freeze({
    schemaVersion: 2,
    format: FORMAT,
    count: 0,
    chainHeadSha256: ZERO_SHA256,
    latest: null,
    latestTimestampCount: 0,
  });
}

function headPayload(head: ReplayHeadV2): ReplayHeadPayloadV2 {
  return Object.freeze({
    schemaVersion: 2,
    format: FORMAT,
    count: head.count,
    chainHeadSha256: head.chainHeadSha256,
    latest: head.latest,
    latestTimestampCount: head.latestTimestampCount,
  });
}

function buildHead(payload: ReplayHeadPayloadV2): ReplayHeadV2 {
  return Object.freeze({ ...payload, headSha256: hashJson(payload) });
}

function validateHead(value: unknown): ReplayHeadV2 {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("research replay v2 HEAD is corrupted");
  }
  const parsed = value as ReplayHeadV2;
  const latest = parsed.latest;
  if (
    parsed.schemaVersion !== 2
    || parsed.format !== FORMAT
    || !isSafeOrdinal(parsed.count)
    || !SHA64.test(parsed.chainHeadSha256)
    || !isSafeOrdinal(parsed.latestTimestampCount)
    || !SHA64.test(parsed.headSha256)
  ) {
    throw new Error("research replay v2 HEAD identity is invalid");
  }
  if (parsed.count === 0) {
    if (parsed.chainHeadSha256 !== ZERO_SHA256 || latest !== null || parsed.latestTimestampCount !== 0) {
      throw new Error("research replay v2 empty HEAD is inconsistent");
    }
  } else {
    const latestTimestamp = latest == null ? Number.NaN : Date.parse(latest.generatedAt);
    if (latest == null || parsed.chainHeadSha256 === ZERO_SHA256 || parsed.latestTimestampCount < 1) {
      throw new Error("research replay v2 HEAD is inconsistent");
    }
    if (
      !SHA64.test(latest.originalRunFingerprintSha256)
      || !SHA64.test(latest.snapshotSha256)
      || !SHA64.test(latest.recordSha256)
      || !latest.generatedAt.trim()
      || !Number.isSafeInteger(latestTimestamp)
      || latestTimestamp < 0
    ) {
      throw new Error("research replay v2 latest identity is invalid");
    }
  }
  if (hashJson(headPayload(parsed)) !== parsed.headSha256) {
    throw new Error("research replay v2 HEAD checksum mismatch");
  }
  return Object.freeze({
    schemaVersion: 2,
    format: FORMAT,
    count: parsed.count,
    chainHeadSha256: parsed.chainHeadSha256,
    latest: parsed.latest == null ? null : Object.freeze({ ...parsed.latest }),
    latestTimestampCount: parsed.latestTimestampCount,
    headSha256: parsed.headSha256,
  });
}

function fsyncDirectory(directory: string): void {
  let fd: number | undefined;
  try {
    fd = fs.openSync(directory, "r");
    fs.fsyncSync(fd);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EINVAL" && code !== "EPERM" && code !== "EISDIR") throw error;
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
}

function writeTemporaryFile(filename: string, content: string): void {
  const fd = fs.openSync(filename, "wx", 0o600);
  try {
    fs.writeFileSync(fd, content, { encoding: "utf8" });
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function atomicReplaceJson(filename: string, value: unknown): void {
  const directory = path.dirname(filename);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeTemporaryFile(temporary, `${JSON.stringify(value)}\n`);
    fs.renameSync(temporary, filename);
    fsyncDirectory(directory);
    try { fs.chmodSync(filename, 0o600); } catch { /* filesystem may not expose POSIX modes */ }
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* preserve published state */ }
    throw error;
  }
}

function writeImmutableJson(filename: string, value: unknown): void {
  const directory = path.dirname(filename);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.existsSync(filename)) return;
  const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeTemporaryFile(temporary, `${JSON.stringify(value)}\n`);
    try {
      fs.linkSync(temporary, filename);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    fs.rmSync(temporary, { force: true });
    fsyncDirectory(directory);
    try { fs.chmodSync(filename, 0o400); } catch { /* immutable-by-contract where chmod is unavailable */ }
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* preserve published state */ }
    throw error;
  }
}

function parseJsonFile<T>(filename: string, corruptionMessage: string): T {
  try {
    return JSON.parse(fs.readFileSync(filename, "utf8")) as T;
  } catch {
    throw new Error(corruptionMessage);
  }
}

function identityOf(record: ReplayRecordV2): ResearchRunReplaySnapshotIdentityV2 {
  return Object.freeze({
    ordinal: record.ordinal,
    originalRunFingerprintSha256: record.snapshot.originalRunFingerprintSha256,
    snapshotSha256: record.snapshot.snapshotSha256,
    generatedAt: generatedAtOf(record.snapshot),
    recordSha256: record.recordSha256,
  });
}

export class FileResearchRunReplaySnapshotObjectStoreV2 {
  private readonly headFilename: string;
  private readonly recordsDirectory: string;
  private readonly fingerprintsDirectory: string;

  public constructor(rootDirectory: string) {
    if (!rootDirectory.trim() || rootDirectory === ":memory:") {
      throw new Error("research replay v2 path must be durable");
    }
    this.headFilename = path.join(rootDirectory, "HEAD.json");
    this.recordsDirectory = path.join(rootDirectory, "records");
    this.fingerprintsDirectory = path.join(rootDirectory, "by-fingerprint");
  }

  private readHead(): ReplayHeadV2 {
    if (!fs.existsSync(this.headFilename)) return buildHead(emptyHeadPayload());
    return validateHead(parseJsonFile<ReplayHeadV2>(this.headFilename, "research replay v2 HEAD is corrupted"));
  }

  private recordFilename(recordSha256: string): string {
    if (!SHA64.test(recordSha256)) throw new Error("research replay v2 record sha is invalid");
    return path.join(this.recordsDirectory, `${recordSha256}.json`);
  }

  private fingerprintFilename(originalRunFingerprintSha256: string): string {
    if (!SHA64.test(originalRunFingerprintSha256)) {
      throw new Error("research replay v2 fingerprint is invalid");
    }
    return path.join(this.fingerprintsDirectory, `${originalRunFingerprintSha256}.json`);
  }

  private readRecordBySha(recordSha256: string): ReplayRecordV2 {
    const filename = this.recordFilename(recordSha256);
    if (!fs.existsSync(filename)) throw new Error("research replay v2 committed record is missing");
    return validateRecord(
      parseJsonFile<ReplayRecordV2>(filename, "research replay v2 record is corrupted"),
      recordSha256,
    );
  }

  private readRecordByFingerprint(originalRunFingerprintSha256: string): ReplayRecordV2 | undefined {
    const filename = this.fingerprintFilename(originalRunFingerprintSha256);
    if (!fs.existsSync(filename)) return undefined;
    const record = validateRecord(parseJsonFile<ReplayRecordV2>(filename, "research replay v2 fingerprint record is corrupted"));
    if (record.snapshot.originalRunFingerprintSha256 !== originalRunFingerprintSha256) {
      throw new Error("research replay v2 fingerprint index provenance mismatch");
    }
    return record;
  }

  private publishFingerprintLink(record: ReplayRecordV2): void {
    const fingerprint = record.snapshot.originalRunFingerprintSha256;
    const destination = this.fingerprintFilename(fingerprint);
    fs.mkdirSync(this.fingerprintsDirectory, { recursive: true, mode: 0o700 });
    if (fs.existsSync(destination)) {
      const existing = this.readRecordByFingerprint(fingerprint);
      if (existing?.recordSha256 !== record.recordSha256) {
        throw new Error("research replay v2 immutable fingerprint conflict");
      }
      return;
    }
    try {
      fs.linkSync(this.recordFilename(record.recordSha256), destination);
      fsyncDirectory(this.fingerprintsDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = this.readRecordByFingerprint(fingerprint);
      if (existing?.recordSha256 !== record.recordSha256) {
        throw new Error("research replay v2 immutable fingerprint conflict");
      }
    }
  }

  /**
   * HEAD is the commit point; the fingerprint hardlink is intentionally published afterwards.
   * If the process dies between those steps, the next operation repairs only the committed chain
   * head from checksum-bound HEAD. Pre-HEAD orphan objects never receive a fingerprint link.
   */
  private ensureChainHeadFingerprintLink(head: ReplayHeadV2): ReplayRecordV2 | undefined {
    if (head.count === 0) return undefined;
    const record = this.readRecordBySha(head.chainHeadSha256);
    if (record.ordinal !== head.count - 1) throw new Error("research replay v2 chain head ordinal mismatch");
    this.publishFingerprintLink(record);
    return record;
  }

  private assertChainHead(head: ReplayHeadV2): void {
    if (head.count === 0) return;
    const record = this.readRecordBySha(head.chainHeadSha256);
    if (record.ordinal !== head.count - 1) throw new Error("research replay v2 chain head ordinal mismatch");
  }

  private orderedRecords(integrityOnly: boolean): readonly ReplayRecordV2[] {
    const head = this.readHead();
    if (head.count === 0) return Object.freeze([]);
    const reversed: ReplayRecordV2[] = [];
    const fingerprints = new Set<string>();
    let currentSha = head.chainHeadSha256;
    for (let expectedOrdinal = head.count - 1; expectedOrdinal >= 0; expectedOrdinal -= 1) {
      const record = this.readRecordBySha(currentSha);
      if (record.ordinal !== expectedOrdinal) throw new Error("research replay v2 record order mismatch");
      const fingerprint = record.snapshot.originalRunFingerprintSha256;
      if (fingerprints.has(fingerprint)) throw new Error("research replay v2 duplicate replay identity");
      fingerprints.add(fingerprint);
      if (!integrityOnly) validateSnapshotSemantics(record.snapshot);
      reversed.push(record);
      currentSha = record.previousRecordSha256;
    }
    if (currentSha !== ZERO_SHA256) throw new Error("research replay v2 chain root mismatch");
    const ordered = reversed.reverse();
    if (head.latestTimestampCount === 1 && head.latest != null) {
      const matchingLatest = ordered.find((entry) => entry.recordSha256 === head.latest!.recordSha256);
      if (
        matchingLatest == null
        || matchingLatest.snapshot.originalRunFingerprintSha256 !== head.latest.originalRunFingerprintSha256
        || matchingLatest.snapshot.snapshotSha256 !== head.latest.snapshotSha256
        || generatedAtOf(matchingLatest.snapshot) !== head.latest.generatedAt
      ) {
        throw new Error("research replay v2 latest identity is not in committed chain");
      }
    }
    return Object.freeze(ordered);
  }

  public recordCount(): number {
    return this.readHead().count;
  }

  public identities(): readonly ResearchRunReplaySnapshotIdentityV2[] {
    return Object.freeze(this.orderedRecords(true).map(identityOf));
  }

  public verifyAll(): number {
    return this.orderedRecords(false).length;
  }

  public read(originalRunFingerprintSha256: string): ResearchRunReplaySnapshot | undefined {
    const fingerprint = originalRunFingerprintSha256.trim().toLowerCase();
    if (!SHA64.test(fingerprint)) throw new Error("research replay v2 fingerprint is invalid");
    const head = this.readHead();
    this.ensureChainHeadFingerprintLink(head);
    const record = this.readRecordByFingerprint(fingerprint);
    if (record == null) return undefined;
    if (record.ordinal >= head.count) throw new Error("research replay v2 fingerprint points to uncommitted record");
    validateSnapshotSemantics(record.snapshot);
    return record.snapshot;
  }

  public latestIdentity(): ResearchRunReplaySnapshotIdentityV2 | undefined {
    const head = this.readHead();
    this.assertChainHead(head);
    if (head.count === 0) return undefined;
    if (head.latestTimestampCount !== 1 || head.latest == null) {
      throw new Error("initial PAPER bootstrap latest Research snapshot is ambiguous");
    }
    const record = this.readRecordBySha(head.latest.recordSha256);
    if (
      record.snapshot.originalRunFingerprintSha256 !== head.latest.originalRunFingerprintSha256
      || record.snapshot.snapshotSha256 !== head.latest.snapshotSha256
      || generatedAtOf(record.snapshot) !== head.latest.generatedAt
    ) {
      throw new Error("research replay v2 latest identity mismatch");
    }
    return identityOf(record);
  }

  public latestIdentityAsync(): Promise<ResearchRunReplaySnapshotIdentityV2 | undefined> {
    try { return Promise.resolve(this.latestIdentity()); }
    catch (error) { return Promise.reject(error); }
  }

  public latest(): ResearchRunReplaySnapshot | undefined {
    const identity = this.latestIdentity();
    if (identity == null) return undefined;
    const record = this.readRecordBySha(identity.recordSha256);
    validateSnapshotSemantics(record.snapshot);
    return record.snapshot;
  }

  public list(): readonly ResearchRunReplaySnapshot[] {
    return Object.freeze(this.orderedRecords(false).map((entry) => entry.snapshot));
  }

  public save(snapshot: ResearchRunReplaySnapshot): ResearchRunReplaySnapshot {
    const next = validateSnapshotSemantics(snapshot);
    const head = this.readHead();
    this.ensureChainHeadFingerprintLink(head);

    const fingerprint = next.originalRunFingerprintSha256;
    const existing = this.readRecordByFingerprint(fingerprint);
    if (existing != null) {
      if (existing.ordinal >= head.count) {
        throw new Error("research replay v2 fingerprint points to uncommitted record");
      }
      if (existing.snapshot.snapshotSha256 !== next.snapshotSha256) {
        throw new Error("research replay v2 immutable run identity conflict");
      }
      validateSnapshotSemantics(existing.snapshot);
      return existing.snapshot;
    }

    const previousRecordSha256 = head.count === 0 ? ZERO_SHA256 : head.chainHeadSha256;
    const record = buildRecord(head.count, previousRecordSha256, next);
    writeImmutableJson(this.recordFilename(record.recordSha256), record);
    const publishedRecord = this.readRecordBySha(record.recordSha256);
    if (
      publishedRecord.ordinal !== head.count
      || publishedRecord.previousRecordSha256 !== previousRecordSha256
      || publishedRecord.snapshot.snapshotSha256 !== next.snapshotSha256
    ) {
      throw new Error("research replay v2 immutable record publication mismatch");
    }

    const nextGeneratedAt = generatedAtOf(next);
    const nextTimestamp = Date.parse(nextGeneratedAt);
    let latest = head.latest;
    let latestTimestampCount = head.latestTimestampCount;
    if (latest == null || nextTimestamp > Date.parse(latest.generatedAt)) {
      latest = Object.freeze({
        originalRunFingerprintSha256: fingerprint,
        snapshotSha256: next.snapshotSha256,
        generatedAt: nextGeneratedAt,
        recordSha256: record.recordSha256,
      });
      latestTimestampCount = 1;
    } else if (nextTimestamp === Date.parse(latest.generatedAt)) {
      latestTimestampCount += 1;
    }

    const nextHead = buildHead(Object.freeze({
      schemaVersion: 2,
      format: FORMAT,
      count: head.count + 1,
      chainHeadSha256: record.recordSha256,
      latest,
      latestTimestampCount,
    }));
    atomicReplaceJson(this.headFilename, nextHead);
    this.publishFingerprintLink(record);
    return next;
  }
}

function isWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09;
}

function streamLegacyArchive(
  filename: string,
  visit: (snapshot: ResearchRunReplaySnapshot, ordinal: number) => void,
): number {
  if (!fs.existsSync(filename)) throw new Error("research replay v2 legacy archive is missing");
  const stat = fs.statSync(filename);
  if (!stat.isFile()) throw new Error("research replay v2 legacy archive is not a file");
  const fd = fs.openSync(filename, "r");
  let ordinal = 0;
  try {
    const prefix = Buffer.alloc(CANONICAL_ARCHIVE_PREFIX.length);
    if (fs.readSync(fd, prefix, 0, prefix.length, 0) !== prefix.length || !prefix.equals(CANONICAL_ARCHIVE_PREFIX)) {
      throw new Error("research replay v2 legacy archive is corrupted");
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
    let segmentStart = -1;

    const finishObject = (): void => {
      const encoded = Buffer.concat(objectParts, objectBytes);
      let snapshot: ResearchRunReplaySnapshot;
      try { snapshot = JSON.parse(encoded.toString("utf8")) as ResearchRunReplaySnapshot; }
      catch { throw new Error("research replay v2 legacy archive is corrupted"); }
      validateSnapshotIntegrity(snapshot);
      if (!SHA64.test(snapshot.originalRunFingerprintSha256) || fingerprints.has(snapshot.originalRunFingerprintSha256)) {
        throw new Error("research replay v2 legacy replay identity is duplicated or invalid");
      }
      fingerprints.add(snapshot.originalRunFingerprintSha256);
      visit(snapshot, ordinal);
      ordinal += 1;
      objectParts = [];
      objectBytes = 0;
      started = false;
      expectSeparator = true;
      segmentStart = -1;
    };

    while (arrayClosedAt == null) {
      const bytesRead = fs.readSync(fd, chunk, 0, chunk.length, position);
      if (bytesRead === 0) throw new Error("research replay v2 legacy archive is corrupted");
      const chunkStart = position;
      position += bytesRead;
      segmentStart = started ? 0 : -1;
      for (let index = 0; index < bytesRead; index += 1) {
        const byte = chunk[index]!;
        if (!started) {
          if (expectSeparator) {
            if (byte === 0x2c) { expectSeparator = false; continue; }
            if (byte === 0x5d) { arrayClosedAt = chunkStart + index + 1; break; }
            if (isWhitespace(byte)) continue;
            throw new Error("research replay v2 legacy archive is corrupted");
          }
          if (byte === 0x5d) { arrayClosedAt = chunkStart + index + 1; break; }
          if (isWhitespace(byte)) continue;
          if (byte !== 0x7b) throw new Error("research replay v2 legacy archive is corrupted");
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
          if (depth < 0) throw new Error("research replay v2 legacy archive is corrupted");
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
    if (started || inString || depth !== 0 || arrayClosedAt == null) {
      throw new Error("research replay v2 legacy archive is corrupted");
    }
    const remaining = stat.size - arrayClosedAt;
    if (remaining < 1 || remaining > STREAM_CHUNK_BYTES) throw new Error("research replay v2 legacy archive is corrupted");
    const suffix = Buffer.alloc(remaining);
    if (fs.readSync(fd, suffix, 0, remaining, arrayClosedAt) !== remaining || suffix.toString("utf8").trim() !== "}") {
      throw new Error("research replay v2 legacy archive is corrupted");
    }
    return ordinal;
  } finally {
    fs.closeSync(fd);
  }
}

function migrationPayload(marker: MigrationMarkerV2): MigrationMarkerPayloadV2 {
  return Object.freeze({
    schemaVersion: 1,
    legacySize: marker.legacySize,
    legacyMtimeMs: marker.legacyMtimeMs,
    recordCount: marker.recordCount,
    logicalReplaySha256: marker.logicalReplaySha256,
  });
}

function readMigrationMarker(rootDirectory: string): MigrationMarkerV2 {
  const filename = path.join(rootDirectory, "MIGRATION.json");
  if (!fs.existsSync(filename)) throw new Error("research replay v2 migration marker is missing");
  const parsed = parseJsonFile<MigrationMarkerV2>(filename, "research replay v2 migration marker is corrupted");
  if (
    parsed.schemaVersion !== 1
    || !Number.isSafeInteger(parsed.legacySize)
    || parsed.legacySize < 0
    || !Number.isFinite(parsed.legacyMtimeMs)
    || !isSafeOrdinal(parsed.recordCount)
    || !SHA64.test(parsed.logicalReplaySha256)
    || !SHA64.test(parsed.markerSha256)
    || hashJson(migrationPayload(parsed)) !== parsed.markerSha256
  ) {
    throw new Error("research replay v2 migration marker is invalid");
  }
  return parsed;
}

export interface ResearchRunReplayMigrationResultV2 {
  readonly recordCount: number;
  readonly logicalReplaySha256: string;
  readonly resumed: boolean;
  readonly alreadyMigrated: boolean;
}

/**
 * Explicit, restart-safe legacy migration. The v1 archive is never mutated. A deterministic
 * sibling staging directory is resumed after interruption; only a fully verified staging tree is
 * atomically renamed into the requested v2 root. Re-running after completion is idempotent.
 */
export function migrateLegacyResearchRunReplayArchiveToV2(
  legacyFilename: string,
  v2RootDirectory: string,
): ResearchRunReplayMigrationResultV2 {
  if (!legacyFilename.trim() || !v2RootDirectory.trim()) throw new Error("research replay v2 migration paths are required");
  const legacyStat = fs.statSync(legacyFilename);
  if (!legacyStat.isFile()) throw new Error("research replay v2 legacy archive is not a file");

  if (fs.existsSync(v2RootDirectory)) {
    const marker = readMigrationMarker(v2RootDirectory);
    if (marker.legacySize !== legacyStat.size || marker.legacyMtimeMs !== legacyStat.mtimeMs) {
      throw new Error("research replay v2 migrated legacy source changed");
    }
    const store = new FileResearchRunReplaySnapshotObjectStoreV2(v2RootDirectory);
    if (store.recordCount() !== marker.recordCount) throw new Error("research replay v2 migrated record count mismatch");
    return Object.freeze({
      recordCount: marker.recordCount,
      logicalReplaySha256: marker.logicalReplaySha256,
      resumed: false,
      alreadyMigrated: true,
    });
  }

  const stagingRoot = `${v2RootDirectory}${MIGRATION_SUFFIX}`;
  fs.mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
  const store = new FileResearchRunReplaySnapshotObjectStoreV2(stagingRoot);
  const existingIdentities = store.identities();
  const logicalHasher = createHash("sha256");
  const resumed = existingIdentities.length > 0;
  let visited = 0;

  const legacyCount = streamLegacyArchive(legacyFilename, (snapshot, ordinal) => {
    logicalHasher.update(`${ordinal}:${snapshot.originalRunFingerprintSha256}:${snapshot.snapshotSha256}\n`, "utf8");
    const existing = existingIdentities[ordinal];
    if (existing != null) {
      if (
        existing.ordinal !== ordinal
        || existing.originalRunFingerprintSha256 !== snapshot.originalRunFingerprintSha256
        || existing.snapshotSha256 !== snapshot.snapshotSha256
      ) {
        throw new Error("research replay v2 interrupted migration prefix mismatch");
      }
    } else {
      store.save(snapshot);
    }
    visited += 1;
  });

  if (legacyCount !== visited || existingIdentities.length > legacyCount || store.recordCount() !== legacyCount) {
    throw new Error("research replay v2 migration cardinality mismatch");
  }
  const logicalReplaySha256 = logicalHasher.digest("hex");
  if (store.verifyAll() !== legacyCount) throw new Error("research replay v2 migration verification count mismatch");

  const payload: MigrationMarkerPayloadV2 = Object.freeze({
    schemaVersion: 1,
    legacySize: legacyStat.size,
    legacyMtimeMs: legacyStat.mtimeMs,
    recordCount: legacyCount,
    logicalReplaySha256,
  });
  const marker: MigrationMarkerV2 = Object.freeze({ ...payload, markerSha256: hashJson(payload) });
  atomicReplaceJson(path.join(stagingRoot, "MIGRATION.json"), marker);
  fsyncDirectory(stagingRoot);
  fs.mkdirSync(path.dirname(path.resolve(v2RootDirectory)), { recursive: true, mode: 0o700 });
  fs.renameSync(stagingRoot, v2RootDirectory);
  fsyncDirectory(path.dirname(path.resolve(v2RootDirectory)));

  return Object.freeze({
    recordCount: legacyCount,
    logicalReplaySha256,
    resumed,
    alreadyMigrated: false,
  });
}
