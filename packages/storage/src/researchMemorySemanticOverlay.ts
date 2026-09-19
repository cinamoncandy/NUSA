import { createHash } from "node:crypto";
import { canonicalResearchJson } from "../../contracts/src/researchRuntime";
import {
  type ResearchMemoryRelationEvent,
  type ResearchMemorySemanticEvent,
  validateResearchMemoryRelationEvent,
  validateResearchMemorySemanticEvent,
} from "../../contracts/src/researchMemorySemantic";

export interface ResearchMemorySemanticOverlayDatabase {
  readonly connection: {
    prepare(sql: string): {
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
      run(...params: unknown[]): unknown;
    };
  };
  transaction<T>(fn: () => T): T;
}

export const researchMemorySemanticOverlayMigration = Object.freeze({
  id: "022_research_memory_semantic_overlay",
  sql: [
    "CREATE TABLE IF NOT EXISTS research_memory_semantic_overlay_meta (",
    "  id INTEGER PRIMARY KEY CHECK (id = 1),",
    "  schema_version INTEGER NOT NULL CHECK (schema_version = 1),",
    "  event_count INTEGER NOT NULL CHECK (event_count >= 0),",
    "  ledger_hash TEXT NOT NULL",
    ");",
    "CREATE TABLE IF NOT EXISTS research_memory_semantic_overlay_events (",
    "  sequence INTEGER PRIMARY KEY,",
    "  event_id TEXT NOT NULL UNIQUE,",
    "  event_kind TEXT NOT NULL CHECK (event_kind IN ('SEMANTIC','RELATION')),",
    "  artifact_kind TEXT NOT NULL,",
    "  artifact_id TEXT NOT NULL,",
    "  artifact_content_sha256 TEXT NOT NULL,",
    "  occurred_at TEXT NOT NULL,",
    "  previous_hash TEXT NOT NULL,",
    "  payload_json TEXT NOT NULL,",
    "  event_hash TEXT NOT NULL UNIQUE",
    ");",
    "CREATE INDEX IF NOT EXISTS idx_research_memory_semantic_overlay_artifact",
    "  ON research_memory_semantic_overlay_events (artifact_kind, artifact_id, sequence);",
    "INSERT OR IGNORE INTO research_memory_semantic_overlay_meta (id, schema_version, event_count, ledger_hash)",
    "  VALUES (1, 1, 0, '0000000000000000000000000000000000000000000000000000000000000000');",
  ].join("\n"),
});

type OverlayEvent =
  | { readonly kind: "SEMANTIC"; readonly value: ResearchMemorySemanticEvent }
  | { readonly kind: "RELATION"; readonly value: ResearchMemoryRelationEvent };

const GENESIS = "0".repeat(64);
const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");
const eventHash = (
  sequence: number,
  previousHash: string,
  kind: OverlayEvent["kind"],
  payloadJson: string,
): string => sha256([String(sequence), previousHash, kind, payloadJson].join("\n"));

function idOf(event: OverlayEvent): string {
  return event.kind === "SEMANTIC" ? event.value.eventId : event.value.relationId;
}

function artifactOf(event: OverlayEvent): {
  readonly artifactKind: string;
  readonly artifactId: string;
  readonly artifactContentSha256: string;
} {
  return event.kind === "SEMANTIC" ? event.value.artifact : event.value.source;
}

function validateEvent(event: OverlayEvent): void {
  if (event.kind === "SEMANTIC") validateResearchMemorySemanticEvent(event.value);
  else validateResearchMemoryRelationEvent(event.value);
}

function payloadOf(event: OverlayEvent): string {
  return canonicalResearchJson(event.value);
}

export class SqliteResearchMemorySemanticOverlayRepository {
  public constructor(private readonly db: ResearchMemorySemanticOverlayDatabase) {}

  public appendSemantic(
    event: ResearchMemorySemanticEvent,
  ): { readonly event: ResearchMemorySemanticEvent; readonly appended: boolean } {
    validateResearchMemorySemanticEvent(event);
    const result = this.append({ kind: "SEMANTIC", value: event });
    return Object.freeze({ event, appended: result.appended });
  }

  public appendRelation(
    event: ResearchMemoryRelationEvent,
  ): { readonly event: ResearchMemoryRelationEvent; readonly appended: boolean } {
    validateResearchMemoryRelationEvent(event);
    const result = this.append({ kind: "RELATION", value: event });
    return Object.freeze({ event, appended: result.appended });
  }

  public listSemantic(): readonly ResearchMemorySemanticEvent[] {
    return Object.freeze(
      this.list()
        .filter((item): item is Extract<OverlayEvent, { kind: "SEMANTIC" }> => item.kind === "SEMANTIC")
        .map((item) => item.value),
    );
  }

  public listRelations(): readonly ResearchMemoryRelationEvent[] {
    return Object.freeze(
      this.list()
        .filter((item): item is Extract<OverlayEvent, { kind: "RELATION" }> => item.kind === "RELATION")
        .map((item) => item.value),
    );
  }

  public headHash(): string {
    this.list();
    return this.readMeta().ledgerHash;
  }

  private append(event: OverlayEvent): { readonly appended: boolean } {
    validateEvent(event);
    const payloadJson = payloadOf(event);
    const eventId = idOf(event);
    const artifact = artifactOf(event);

    return this.db.transaction(() => {
      this.list();
      const existing = this.db.connection.prepare(
        "SELECT event_kind, payload_json FROM research_memory_semantic_overlay_events WHERE event_id = ?",
      ).get(eventId) as { event_kind: string; payload_json: string } | undefined;
      if (existing != null) {
        if (existing.event_kind !== event.kind || existing.payload_json !== payloadJson) {
          throw new Error("RESEARCH_MEMORY_SEMANTIC_OVERLAY_REPLAY_MISMATCH");
        }
        return Object.freeze({ appended: false });
      }

      const meta = this.readMeta();
      const sequence = meta.eventCount + 1;
      const previousHash = meta.ledgerHash;
      const nextHash = eventHash(sequence, previousHash, event.kind, payloadJson);
      this.db.connection.prepare(
        "INSERT INTO research_memory_semantic_overlay_events (sequence, event_id, event_kind, artifact_kind, artifact_id, artifact_content_sha256, occurred_at, previous_hash, payload_json, event_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        sequence,
        eventId,
        event.kind,
        artifact.artifactKind,
        artifact.artifactId,
        artifact.artifactContentSha256,
        event.value.occurredAt,
        previousHash,
        payloadJson,
        nextHash,
      );
      this.db.connection.prepare(
        "UPDATE research_memory_semantic_overlay_meta SET event_count = ?, ledger_hash = ? WHERE id = 1",
      ).run(sequence, nextHash);
      return Object.freeze({ appended: true });
    });
  }

  private list(): readonly OverlayEvent[] {
    const rows = this.db.connection.prepare(
      "SELECT sequence, event_id, event_kind, artifact_kind, artifact_id, artifact_content_sha256, occurred_at, previous_hash, payload_json, event_hash FROM research_memory_semantic_overlay_events ORDER BY sequence ASC",
    ).all() as Array<{
      sequence: number;
      event_id: string;
      event_kind: string;
      artifact_kind: string;
      artifact_id: string;
      artifact_content_sha256: string;
      occurred_at: string;
      previous_hash: string;
      payload_json: string;
      event_hash: string;
    }>;

    let previousHash = GENESIS;
    const events = rows.map((row, index): OverlayEvent => {
      if (
        row.sequence !== index + 1 ||
        row.previous_hash !== previousHash ||
        row.event_hash !== eventHash(
          row.sequence,
          row.previous_hash,
          row.event_kind as OverlayEvent["kind"],
          row.payload_json,
        )
      ) {
        throw new Error("RESEARCH_MEMORY_SEMANTIC_OVERLAY_INTEGRITY_VIOLATION");
      }

      let event: OverlayEvent;
      try {
        if (row.event_kind === "SEMANTIC") {
          const value = JSON.parse(row.payload_json) as ResearchMemorySemanticEvent;
          validateResearchMemorySemanticEvent(value);
          event = { kind: "SEMANTIC", value };
        } else if (row.event_kind === "RELATION") {
          const value = JSON.parse(row.payload_json) as ResearchMemoryRelationEvent;
          validateResearchMemoryRelationEvent(value);
          event = { kind: "RELATION", value };
        } else {
          throw new Error("unknown event kind");
        }
      } catch {
        throw new Error("RESEARCH_MEMORY_SEMANTIC_OVERLAY_INTEGRITY_VIOLATION");
      }

      const artifact = artifactOf(event);
      if (
        idOf(event) !== row.event_id ||
        artifact.artifactKind !== row.artifact_kind ||
        artifact.artifactId !== row.artifact_id ||
        artifact.artifactContentSha256 !== row.artifact_content_sha256 ||
        event.value.occurredAt !== row.occurred_at
      ) {
        throw new Error("RESEARCH_MEMORY_SEMANTIC_OVERLAY_INTEGRITY_VIOLATION");
      }
      previousHash = row.event_hash;
      return Object.freeze(event);
    });

    const meta = this.readMeta();
    if (meta.eventCount !== events.length || meta.ledgerHash !== previousHash) {
      throw new Error("RESEARCH_MEMORY_SEMANTIC_OVERLAY_META_MISMATCH");
    }
    return Object.freeze(events);
  }

  private readMeta(): { readonly eventCount: number; readonly ledgerHash: string } {
    const row = this.db.connection.prepare(
      "SELECT schema_version, event_count, ledger_hash FROM research_memory_semantic_overlay_meta WHERE id = 1",
    ).get() as { schema_version: number; event_count: number; ledger_hash: string } | undefined;
    if (
      row == null ||
      row.schema_version !== 1 ||
      !Number.isSafeInteger(row.event_count) ||
      row.event_count < 0 ||
      !/^[a-f0-9]{64}$/.test(row.ledger_hash)
    ) {
      throw new Error("RESEARCH_MEMORY_SEMANTIC_OVERLAY_META_INVALID");
    }
    return Object.freeze({ eventCount: row.event_count, ledgerHash: row.ledger_hash });
  }
}
