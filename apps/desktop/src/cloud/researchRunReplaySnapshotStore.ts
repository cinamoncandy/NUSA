import fs from "node:fs";
import path from "node:path";
import {
  replayResearchRunWithPaperEvidence,
  type ResearchRunReplaySnapshot,
} from "./researchRunReplaySnapshot";

const FORBIDDEN_KEY = /(authorization|bearer|token|secret|password|api[_-]?key|access[_-]?key|private[_-]?key|cookie|jwt|credential)/i;
const SHA64 = /^[0-9a-f]{64}$/;

interface ResearchRunReplaySnapshotFile {
  readonly schemaVersion: 1;
  readonly snapshots: readonly ResearchRunReplaySnapshot[];
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

export interface ResearchRunReplaySnapshotReader {
  read(originalRunFingerprintSha256: string): ResearchRunReplaySnapshot | undefined;
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
    return this.readFile().snapshots.find((snapshot) => snapshot.originalRunFingerprintSha256 === fingerprint);
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
