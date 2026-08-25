import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  validateRealReadOnlyEvent,
  type RealReadOnlyEvent
} from "../../../packages/contracts/src/realReadOnlyObservability";

const SCHEMA_VERSION = 1;
const DEFAULT_MAXIMUM_EVENTS = 500;
const MAXIMUM_EVENTS = 500;

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value != null && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const identityContent = (event: RealReadOnlyEvent): Omit<RealReadOnlyEvent, "sequence"> => {
  const { sequence: _sequence, ...content } = event;
  return content;
};
const sameEvidence = (left: RealReadOnlyEvent, right: RealReadOnlyEvent): boolean => stableJson(identityContent(left)) === stableJson(identityContent(right));
const digest = (event: RealReadOnlyEvent): string => createHash("sha256").update(stableJson(identityContent(event)), "utf8").digest("hex");

function normalize(events: readonly RealReadOnlyEvent[], maximumEvents: number): readonly RealReadOnlyEvent[] {
  const byId = new Map<string, RealReadOnlyEvent>();
  for (const input of events) {
    const event = validateRealReadOnlyEvent(input);
    const previous = byId.get(event.id);
    if (previous != null && !sameEvidence(previous, event)) throw new Error("REAL_READ_ONLY event identity conflict");
    byId.set(event.id, event);
  }
  const ordered = [...byId.values()].sort((left, right) => left.occurredAt - right.occurredAt || left.sequence - right.sequence || left.id.localeCompare(right.id));
  const kept = ordered.slice(Math.max(0, ordered.length - maximumEvents));
  return Object.freeze(kept.map((event, index) => Object.freeze({ ...event, sequence: index + 1, reasonCodes: Object.freeze([...event.reasonCodes]) })));
}

type Row = { event_id: string; occurred_at: number; schema_version: number; payload_json: string };

export interface RealReadOnlyEventRecorderOptions {
  readonly persistencePath?: string;
  readonly maximumEvents?: number;
}

/** Durable, bounded, read-only evidence history. It never replays into an account or execution path. */
export class RealReadOnlyEventRecorder {
  private readonly maximumEvents: number;
  private readonly persistencePath?: string;
  private readonly byId = new Map<string, RealReadOnlyEvent>();
  private database?: DatabaseSync;
  private hydrated = false;

  public constructor(options: RealReadOnlyEventRecorderOptions = {}) {
    this.maximumEvents = options.maximumEvents ?? DEFAULT_MAXIMUM_EVENTS;
    if (!Number.isSafeInteger(this.maximumEvents) || this.maximumEvents < 1 || this.maximumEvents > MAXIMUM_EVENTS) throw new Error("REAL_READ_ONLY event limit is invalid");
    this.persistencePath = options.persistencePath?.trim() || undefined;
  }

  public record(event: RealReadOnlyEvent): RealReadOnlyEvent {
    this.hydrate();
    const safe = validateRealReadOnlyEvent(event);
    const previous = this.byId.get(safe.id);
    if (previous != null) {
      if (!sameEvidence(previous, safe)) throw new Error("REAL_READ_ONLY event identity conflict");
      return previous;
    }
    this.byId.set(safe.id, safe);
    this.pruneMemory();
    this.persist(safe);
    return safe;
  }

  public replay(): readonly RealReadOnlyEvent[] {
    this.hydrate();
    return normalize([...this.byId.values()], this.maximumEvents);
  }

  public close(): void { try { this.database?.close(); } catch { /* observability close is best-effort */ } this.database = undefined; }

  private hydrate(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    if (this.persistencePath == null || this.persistencePath === ":memory:") return;
    try {
      const db = new DatabaseSync(this.persistencePath);
      db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
      db.exec("CREATE TABLE IF NOT EXISTS real_readonly_observability_events (event_id TEXT PRIMARY KEY, occurred_at INTEGER NOT NULL, schema_version INTEGER NOT NULL, payload_json TEXT NOT NULL, payload_hash TEXT NOT NULL)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_real_readonly_observability_order ON real_readonly_observability_events(occurred_at ASC, event_id ASC)");
      const rows = db.prepare("SELECT event_id, occurred_at, schema_version, payload_json FROM real_readonly_observability_events WHERE schema_version = ? ORDER BY occurred_at ASC, event_id ASC").all(SCHEMA_VERSION) as Row[];
      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.payload_json) as RealReadOnlyEvent;
          const event = validateRealReadOnlyEvent(parsed);
          if (event.id !== row.event_id || event.occurredAt !== Number(row.occurred_at)) continue;
          const storedHash = String((db.prepare("SELECT payload_hash FROM real_readonly_observability_events WHERE event_id = ?").get(row.event_id) as { payload_hash?: string } | undefined)?.payload_hash ?? "");
          if (storedHash !== digest(event)) continue;
          const previous = this.byId.get(event.id);
          if (previous != null && !sameEvidence(previous, event)) throw new Error("REAL_READ_ONLY persisted identity conflict");
          this.byId.set(event.id, event);
        } catch { /* malformed or unsafe persisted evidence is rejected */ }
      }
      this.database = db;
      this.pruneMemory();
      this.prunePersistence();
    } catch { try { this.database?.close(); } catch { /* no-op */ } this.database = undefined; }
  }

  private persist(event: RealReadOnlyEvent): void {
    if (this.database == null) return;
    try {
      const payload = stableJson(event);
      this.database.prepare("INSERT INTO real_readonly_observability_events (event_id, occurred_at, schema_version, payload_json, payload_hash) VALUES (?, ?, ?, ?, ?) ON CONFLICT(event_id) DO NOTHING").run(event.id, event.occurredAt, SCHEMA_VERSION, payload, digest(event));
      this.prunePersistence();
    } catch { /* observability persistence must not create mutation authority */ }
  }

  private pruneMemory(): void {
    const kept = normalize([...this.byId.values()], this.maximumEvents);
    this.byId.clear();
    for (const event of kept) this.byId.set(event.id, event);
  }

  private prunePersistence(): void {
    if (this.database == null) return;
    this.database.prepare("DELETE FROM real_readonly_observability_events WHERE event_id NOT IN (SELECT event_id FROM real_readonly_observability_events WHERE schema_version = ? ORDER BY occurred_at DESC, event_id ASC LIMIT ?)").run(SCHEMA_VERSION, this.maximumEvents);
  }
}

export function mergeRealReadOnlyEvents(events: readonly RealReadOnlyEvent[], maximumEvents = DEFAULT_MAXIMUM_EVENTS): readonly RealReadOnlyEvent[] {
  if (!Number.isSafeInteger(maximumEvents) || maximumEvents < 1 || maximumEvents > MAXIMUM_EVENTS) throw new Error("REAL_READ_ONLY event limit is invalid");
  return normalize(events, maximumEvents);
}
