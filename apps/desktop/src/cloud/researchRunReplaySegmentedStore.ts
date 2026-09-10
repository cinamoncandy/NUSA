import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  replayResearchRunWithPaperEvidence,
  validateResearchRunReplaySnapshotIntegrity,
  type ResearchRunReplaySnapshot,
} from "./researchRunReplaySnapshot";
import type {
  ResearchRunReplaySnapshotIdentity,
  ResearchRunReplaySnapshotReader,
  ResearchRunReplaySnapshotWriter,
} from "./researchRunReplaySnapshotStore";

const SHA64 = /^[0-9a-f]{64}$/;
const FORBIDDEN_KEY = /(authorization|bearer|token|secret|password|api[_-]?key|access[_-]?key|private[_-]?key|cookie|jwt|credential)/i;
const COMMIT_FILE = /^(\d{16})\.([0-9a-f]{64})\.json$/;

interface SegmentedReplayCommitCore {
  readonly schemaVersion: 2;
  readonly sequence: number;
  readonly previousCommitFile: string | null;
  readonly previousCommitSha256: string | null;
  readonly originalRunFingerprintSha256: string;
  readonly snapshotSha256: string;
  readonly segmentFile: string;
}

interface SegmentedReplayCommit extends SegmentedReplayCommitCore {
  readonly commitSha256: string;
}

interface SegmentedReplayHead {
  readonly schemaVersion: 2;
  readonly sequence: number;
  readonly commitFile: string;
  readonly commitSha256: string;
}

interface SegmentedReplayPointer {
  readonly schemaVersion: 2;
  readonly originalRunFingerprintSha256: string;
  readonly commitFile: string;
  readonly commitSha256: string;
}

interface LoadedCommit {
  readonly filename: string;
  readonly value: SegmentedReplayCommit;
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

function validateSnapshot(snapshot: ResearchRunReplaySnapshot): ResearchRunReplaySnapshot {
  rejectForbidden(snapshot);
  replayResearchRunWithPaperEvidence(snapshot, Object.freeze({}));
  return snapshot;
}

function validateSnapshotIntegrity(snapshot: ResearchRunReplaySnapshot): ResearchRunReplaySnapshot {
  rejectForbidden(snapshot);
  validateResearchRunReplaySnapshotIntegrity(snapshot);
  return snapshot;
}

function sha256(value: Buffer | string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function encodeCommitCore(value: SegmentedReplayCommitCore): string {
  return JSON.stringify({
    schemaVersion: value.schemaVersion,
    sequence: value.sequence,
    previousCommitFile: value.previousCommitFile,
    previousCommitSha256: value.previousCommitSha256,
    originalRunFingerprintSha256: value.originalRunFingerprintSha256,
    snapshotSha256: value.snapshotSha256,
    segmentFile: value.segmentFile,
  });
}

function ensureSafeDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("research replay segmented store directory is invalid");
}

function writeCompleteTemporary(filename: string, payload: string): string {
  const temporary = `${filename}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  const fd = fs.openSync(temporary, "wx", 0o600);
  try {
    const encoded = Buffer.from(payload, "utf8");
    if (fs.writeSync(fd, encoded, 0, encoded.length, 0) !== encoded.length) {
      throw new Error("research replay segmented store write was incomplete");
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return temporary;
}

function writeImmutableFile(filename: string, payload: string): void {
  ensureSafeDirectory(path.dirname(filename));
  const temporary = writeCompleteTemporary(filename, payload);
  try {
    fs.linkSync(temporary, filename);
    try { fs.chmodSync(filename, 0o600); } catch { /* integrity is content-bound */ }
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch { /* fail closed on future reads */ }
  }
}

function replaceAtomicFile(filename: string, payload: string): void {
  ensureSafeDirectory(path.dirname(filename));
  const temporary = writeCompleteTemporary(filename, payload);
  try {
    fs.renameSync(temporary, filename);
    try { fs.chmodSync(filename, 0o600); } catch { /* integrity is content-bound */ }
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* preserve prior committed head */ }
    throw error;
  }
}

function parseJsonObject<T>(filename: string, label: string): T {
  let value: unknown;
  try { value = JSON.parse(fs.readFileSync(filename, "utf8")); }
  catch { throw new Error(`research replay segmented ${label} is corrupted`); }
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`research replay segmented ${label} is corrupted`);
  }
  return value as T;
}

export class SegmentedResearchRunReplaySnapshotStore implements ResearchRunReplaySnapshotReader, ResearchRunReplaySnapshotWriter {
  private readonly root: string;
  private readonly segmentsDirectory: string;
  private readonly commitsDirectory: string;
  private readonly pointersDirectory: string;
  private readonly headPath: string;
  private readonly lockPath: string;

  public constructor(rootDirectory: string) {
    const trimmed = rootDirectory.trim();
    if (!trimmed || trimmed === ":memory:") throw new Error("research replay segmented store path must be durable");
    this.root = path.resolve(trimmed);
    this.segmentsDirectory = path.join(this.root, "segments");
    this.commitsDirectory = path.join(this.root, "commits");
    this.pointersDirectory = path.join(this.root, "by-fingerprint");
    this.headPath = path.join(this.root, "head.json");
    this.lockPath = path.join(this.root, "writer.lock");
  }

  private prepareDirectories(): void {
    ensureSafeDirectory(this.root);
    ensureSafeDirectory(this.segmentsDirectory);
    ensureSafeDirectory(this.commitsDirectory);
    ensureSafeDirectory(this.pointersDirectory);
  }

  private segmentPath(fingerprint: string): string {
    if (!SHA64.test(fingerprint)) throw new Error("research replay segmented fingerprint is invalid");
    return path.join(this.segmentsDirectory, `${fingerprint}.json`);
  }

  private pointerPath(fingerprint: string): string {
    if (!SHA64.test(fingerprint)) throw new Error("research replay segmented fingerprint is invalid");
    return path.join(this.pointersDirectory, `${fingerprint}.json`);
  }

  private loadHead(): SegmentedReplayHead | undefined {
    if (!fs.existsSync(this.headPath)) return undefined;
    const value = parseJsonObject<SegmentedReplayHead>(this.headPath, "head");
    if (
      value.schemaVersion !== 2
      || !Number.isSafeInteger(value.sequence)
      || value.sequence < 0
      || typeof value.commitFile !== "string"
      || !COMMIT_FILE.test(value.commitFile)
      || !SHA64.test(value.commitSha256)
    ) throw new Error("research replay segmented head is invalid");
    const loaded = this.loadCommit(value.commitFile);
    if (loaded.value.sequence !== value.sequence || loaded.value.commitSha256 !== value.commitSha256) {
      throw new Error("research replay segmented head provenance mismatch");
    }
    return Object.freeze({ ...value });
  }

  private loadCommit(filename: string): LoadedCommit {
    const match = COMMIT_FILE.exec(filename);
    if (match == null) throw new Error("research replay segmented commit filename is invalid");
    const expectedSequence = Number.parseInt(match[1]!, 10);
    const expectedSha = match[2]!;
    if (!Number.isSafeInteger(expectedSequence) || expectedSequence < 0) {
      throw new Error("research replay segmented commit sequence is invalid");
    }
    const fullPath = path.join(this.commitsDirectory, filename);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      throw new Error("research replay segmented commit is missing");
    }
    const value = parseJsonObject<SegmentedReplayCommit>(fullPath, "commit");
    const previousPairValid = value.previousCommitFile == null && value.previousCommitSha256 == null
      || typeof value.previousCommitFile === "string" && COMMIT_FILE.test(value.previousCommitFile)
        && typeof value.previousCommitSha256 === "string" && SHA64.test(value.previousCommitSha256);
    if (
      value.schemaVersion !== 2
      || value.sequence !== expectedSequence
      || !previousPairValid
      || !SHA64.test(value.originalRunFingerprintSha256)
      || !SHA64.test(value.snapshotSha256)
      || value.segmentFile !== `${value.originalRunFingerprintSha256}.json`
      || !SHA64.test(value.commitSha256)
    ) throw new Error("research replay segmented commit is invalid");
    const core: SegmentedReplayCommitCore = {
      schemaVersion: 2,
      sequence: value.sequence,
      previousCommitFile: value.previousCommitFile,
      previousCommitSha256: value.previousCommitSha256,
      originalRunFingerprintSha256: value.originalRunFingerprintSha256,
      snapshotSha256: value.snapshotSha256,
      segmentFile: value.segmentFile,
    };
    const computed = sha256(encodeCommitCore(core));
    if (computed !== value.commitSha256 || expectedSha !== value.commitSha256) {
      throw new Error("research replay segmented commit checksum mismatch");
    }
    return Object.freeze({ filename, value: Object.freeze({ ...value }) });
  }

  private loadSegment(commit: SegmentedReplayCommit, semantic = true): ResearchRunReplaySnapshot {
    const filename = this.segmentPath(commit.originalRunFingerprintSha256);
    if (path.basename(filename) !== commit.segmentFile || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
      throw new Error("research replay segmented snapshot segment is missing");
    }
    let snapshot: ResearchRunReplaySnapshot;
    try { snapshot = JSON.parse(fs.readFileSync(filename, "utf8")) as ResearchRunReplaySnapshot; }
    catch { throw new Error("research replay segmented snapshot segment is corrupted"); }
    const checked = semantic ? validateSnapshot(snapshot) : validateSnapshotIntegrity(snapshot);
    if (
      checked.originalRunFingerprintSha256 !== commit.originalRunFingerprintSha256
      || checked.snapshotSha256 !== commit.snapshotSha256
    ) throw new Error("research replay segmented snapshot provenance mismatch");
    return checked;
  }

  private walkCommittedChain(head: SegmentedReplayHead, visit: (commit: LoadedCommit) => boolean | void): void {
    let current = this.loadCommit(head.commitFile);
    const seen = new Set<string>();
    while (true) {
      if (seen.has(current.value.commitSha256)) throw new Error("research replay segmented commit chain cycle detected");
      seen.add(current.value.commitSha256);
      if (visit(current) === false) return;
      const previousFile = current.value.previousCommitFile;
      const previousSha = current.value.previousCommitSha256;
      if (previousFile == null || previousSha == null) {
        if (current.value.sequence !== 0 || previousFile !== null || previousSha !== null) {
          throw new Error("research replay segmented commit chain root is invalid");
        }
        return;
      }
      const previous = this.loadCommit(previousFile);
      if (
        previous.value.commitSha256 !== previousSha
        || previous.value.sequence + 1 !== current.value.sequence
      ) throw new Error("research replay segmented commit chain is discontinuous");
      current = previous;
    }
  }

  private findCommittedFingerprint(head: SegmentedReplayHead, fingerprint: string): LoadedCommit | undefined {
    const pointerPath = this.pointerPath(fingerprint);
    if (fs.existsSync(pointerPath)) {
      const pointer = parseJsonObject<SegmentedReplayPointer>(pointerPath, "fingerprint pointer");
      if (
        pointer.schemaVersion !== 2
        || pointer.originalRunFingerprintSha256 !== fingerprint
        || typeof pointer.commitFile !== "string"
        || !COMMIT_FILE.test(pointer.commitFile)
        || !SHA64.test(pointer.commitSha256)
      ) throw new Error("research replay segmented fingerprint pointer is invalid");
      const pointed = this.loadCommit(pointer.commitFile);
      if (
        pointed.value.commitSha256 !== pointer.commitSha256
        || pointed.value.originalRunFingerprintSha256 !== fingerprint
      ) throw new Error("research replay segmented fingerprint pointer provenance mismatch");
      let member = false;
      this.walkCommittedChain(head, (entry) => {
        if (entry.value.commitSha256 === pointed.value.commitSha256) { member = true; return false; }
      });
      if (!member) throw new Error("research replay segmented fingerprint pointer is not committed");
      return pointed;
    }

    let found: LoadedCommit | undefined;
    this.walkCommittedChain(head, (entry) => {
      if (entry.value.originalRunFingerprintSha256 === fingerprint) {
        found = entry;
        return false;
      }
    });
    if (found != null) this.publishPointer(found);
    return found;
  }

  private publishPointer(commit: LoadedCommit): void {
    const pointer: SegmentedReplayPointer = Object.freeze({
      schemaVersion: 2,
      originalRunFingerprintSha256: commit.value.originalRunFingerprintSha256,
      commitFile: commit.filename,
      commitSha256: commit.value.commitSha256,
    });
    try { replaceAtomicFile(this.pointerPath(commit.value.originalRunFingerprintSha256), `${JSON.stringify(pointer)}\n`); }
    catch { /* cache-only; committed head remains authoritative */ }
  }

  private acquireWriterLock(): number {
    this.prepareDirectories();
    try {
      const fd = fs.openSync(this.lockPath, "wx", 0o600);
      const payload = Buffer.from(`${process.pid}\n`, "utf8");
      fs.writeSync(fd, payload, 0, payload.length, 0);
      fs.fsyncSync(fd);
      return fd;
    } catch {
      throw new Error("research replay segmented writer lock is unavailable");
    }
  }

  private releaseWriterLock(fd: number): void {
    try { fs.closeSync(fd); } finally {
      try { fs.rmSync(this.lockPath, { force: true }); } catch { /* fail closed on next writer */ }
    }
  }

  public read(originalRunFingerprintSha256: string): ResearchRunReplaySnapshot | undefined {
    const fingerprint = originalRunFingerprintSha256.trim().toLowerCase();
    if (!SHA64.test(fingerprint)) throw new Error("research replay snapshot run fingerprint is invalid");
    const head = this.loadHead();
    if (head == null) return undefined;
    const commit = this.findCommittedFingerprint(head, fingerprint);
    return commit == null ? undefined : this.loadSegment(commit.value, true);
  }

  public latest(): ResearchRunReplaySnapshot | undefined {
    const head = this.loadHead();
    if (head == null) return undefined;
    return this.loadSegment(this.loadCommit(head.commitFile).value, true);
  }

  public latestIdentityAsync(): Promise<ResearchRunReplaySnapshotIdentity | undefined> {
    const head = this.loadHead();
    if (head == null) return Promise.resolve(undefined);
    const commit = this.loadCommit(head.commitFile).value;
    const snapshot = this.loadSegment(commit, false);
    const generatedAt = snapshot.options.generatedAt;
    if (typeof generatedAt !== "string" || !generatedAt.trim() || !Number.isSafeInteger(Date.parse(generatedAt))) {
      return Promise.reject(new Error("initial PAPER bootstrap Research generatedAt is invalid"));
    }
    return Promise.resolve(Object.freeze({
      originalRunFingerprintSha256: commit.originalRunFingerprintSha256,
      generatedAt,
    }));
  }

  public list(): readonly ResearchRunReplaySnapshot[] {
    const head = this.loadHead();
    if (head == null) return Object.freeze([]);
    const reversed: LoadedCommit[] = [];
    const fingerprints = new Set<string>();
    this.walkCommittedChain(head, (entry) => {
      if (fingerprints.has(entry.value.originalRunFingerprintSha256)) {
        throw new Error("research replay segmented commit identity is duplicated");
      }
      fingerprints.add(entry.value.originalRunFingerprintSha256);
      reversed.push(entry);
    });
    reversed.reverse();
    return Object.freeze(reversed.map((entry) => this.loadSegment(entry.value, true)));
  }

  public save(snapshot: ResearchRunReplaySnapshot): ResearchRunReplaySnapshot {
    const next = validateSnapshot(snapshot);
    const fingerprint = next.originalRunFingerprintSha256;
    if (!SHA64.test(fingerprint) || !SHA64.test(next.snapshotSha256)) {
      throw new Error("research replay segmented snapshot identity is invalid");
    }

    const lockFd = this.acquireWriterLock();
    try {
      const head = this.loadHead();
      if (head != null) {
        const existing = this.findCommittedFingerprint(head, fingerprint);
        if (existing != null) {
          if (existing.value.snapshotSha256 !== next.snapshotSha256) {
            throw new Error("research replay snapshot immutable run identity conflict");
          }
          return this.loadSegment(existing.value, true);
        }
      }

      const segmentPath = this.segmentPath(fingerprint);
      if (fs.existsSync(segmentPath)) {
        let orphan: ResearchRunReplaySnapshot;
        try { orphan = JSON.parse(fs.readFileSync(segmentPath, "utf8")) as ResearchRunReplaySnapshot; }
        catch { throw new Error("research replay segmented orphan snapshot is corrupted"); }
        const checked = validateSnapshotIntegrity(orphan);
        if (checked.originalRunFingerprintSha256 !== fingerprint || checked.snapshotSha256 !== next.snapshotSha256) {
          throw new Error("research replay snapshot immutable run identity conflict");
        }
      } else {
        writeImmutableFile(segmentPath, `${JSON.stringify(next)}\n`);
      }

      const sequence = head == null ? 0 : head.sequence + 1;
      if (!Number.isSafeInteger(sequence)) throw new Error("research replay segmented commit sequence overflow");
      const core: SegmentedReplayCommitCore = Object.freeze({
        schemaVersion: 2,
        sequence,
        previousCommitFile: head?.commitFile ?? null,
        previousCommitSha256: head?.commitSha256 ?? null,
        originalRunFingerprintSha256: fingerprint,
        snapshotSha256: next.snapshotSha256,
        segmentFile: `${fingerprint}.json`,
      });
      const commitSha256 = sha256(encodeCommitCore(core));
      const commit: SegmentedReplayCommit = Object.freeze({ ...core, commitSha256 });
      const commitFile = `${String(sequence).padStart(16, "0")}.${commitSha256}.json`;
      const commitPath = path.join(this.commitsDirectory, commitFile);
      if (!fs.existsSync(commitPath)) writeImmutableFile(commitPath, `${JSON.stringify(commit)}\n`);
      else {
        const existingCommit = this.loadCommit(commitFile);
        if (existingCommit.value.commitSha256 !== commitSha256) throw new Error("research replay segmented commit conflict");
      }

      const newHead: SegmentedReplayHead = Object.freeze({
        schemaVersion: 2,
        sequence,
        commitFile,
        commitSha256,
      });
      replaceAtomicFile(this.headPath, `${JSON.stringify(newHead)}\n`);
      this.publishPointer(Object.freeze({ filename: commitFile, value: commit }));
      return next;
    } finally {
      this.releaseWriterLock(lockFd);
    }
  }
}
