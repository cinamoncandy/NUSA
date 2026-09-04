import fs from "node:fs";
import path from "node:path";
import {
  replayResearchRunWithPaperEvidence,
  type ResearchRunReplaySnapshot,
} from "./researchRunReplaySnapshot";

const FORBIDDEN_KEY = /(authorization|bearer|token|secret|password|api[_-]?key|access[_-]?key|private[_-]?key|cookie|jwt|credential)/i;

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
  read(): ResearchRunReplaySnapshot | undefined;
}

export interface ResearchRunReplaySnapshotWriter {
  save(snapshot: ResearchRunReplaySnapshot): ResearchRunReplaySnapshot;
}

/**
 * Single-current-run durable snapshot store. A new Research run may replace the previous snapshot
 * only when its immutable run identity changes; replay of the same run must be byte-equivalent.
 * The write is atomic and owner-only where POSIX permissions are available.
 */
export class FileResearchRunReplaySnapshotStore implements ResearchRunReplaySnapshotReader, ResearchRunReplaySnapshotWriter {
  public constructor(private readonly filename: string) {
    if (!filename.trim() || filename === ":memory:") throw new Error("research replay snapshot path must be durable");
  }

  public read(): ResearchRunReplaySnapshot | undefined {
    if (!fs.existsSync(this.filename)) return undefined;
    const stat = fs.statSync(this.filename);
    if (!stat.isFile()) throw new Error("research replay snapshot path is not a file");
    let parsed: ResearchRunReplaySnapshot;
    try { parsed = JSON.parse(fs.readFileSync(this.filename, "utf8")) as ResearchRunReplaySnapshot; }
    catch { throw new Error("research replay snapshot file is corrupted"); }
    return validate(parsed);
  }

  public save(snapshot: ResearchRunReplaySnapshot): ResearchRunReplaySnapshot {
    const next = validate(snapshot);
    const existing = this.read();
    if (existing != null && existing.originalRunFingerprintSha256 === next.originalRunFingerprintSha256) {
      if (existing.snapshotSha256 !== next.snapshotSha256) throw new Error("research replay snapshot immutable run identity conflict");
      return existing;
    }
    const directory = path.dirname(path.resolve(this.filename));
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.filename}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(next)}\n`, { encoding: "utf8", mode: 0o600, flag: "w" });
    fs.renameSync(temporary, this.filename);
    try { fs.chmodSync(this.filename, 0o600); } catch { /* integrity remains checksum/provenance bound */ }
    return next;
  }
}
