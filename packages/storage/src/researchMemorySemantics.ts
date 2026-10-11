import type { DatabaseSync } from "node:sqlite";
import {
  appendResearchMemoryRelationEvent,
  appendResearchMemorySemanticEvent,
  replayResearchMemoryOverlayEvents,
  researchMemoryRelationEventIdentity,
  researchMemorySemanticEventIdentity,
  type ResearchMemoryOverlayEvent,
  type ResearchMemoryRelationEvent,
  type ResearchMemoryRelationInput,
  type ResearchMemorySemanticEvent,
  type ResearchMemorySemanticInput,
} from "../../contracts/src/researchMemorySemantics";

export interface ResearchSemanticMemoryDatabase {
  readonly connection: DatabaseSync;
  transaction<T>(fn: () => T): T;
}

const decode = (row: Record<string, unknown>): ResearchMemoryOverlayEvent =>
  JSON.parse(String(row.event_json)) as ResearchMemoryOverlayEvent;

const primaryArtifact = (event: ResearchMemoryOverlayEvent) =>
  event.eventKind === "SEMANTIC" ? event.artifact : event.sourceArtifact;

export class SqliteResearchSemanticMemoryRepository {
  constructor(private readonly db: ResearchSemanticMemoryDatabase) {}

  list(): readonly ResearchMemoryOverlayEvent[] {
    const rows = this.db.connection.prepare(
      "SELECT sequence, event_kind, identity, artifact_kind, artifact_id, artifact_sha256, semantic_identity, independence_group_id, previous_hash, event_json, hash FROM research_memory_semantic_events ORDER BY sequence ASC"
    ).all() as Record<string, unknown>[];

    const records = rows.map((row) => {
      const event = decode(row);
      const artifact = primaryArtifact(event);
      if (
        Number(row.sequence) !== event.sequence ||
        String(row.event_kind) !== event.eventKind ||
        String(row.identity) !== event.identity ||
        String(row.artifact_kind) !== artifact.artifactKind ||
        String(row.artifact_id) !== artifact.artifactId ||
        String(row.artifact_sha256) !== artifact.artifactContentSha256 ||
        String(row.previous_hash) !== event.previousHash ||
        String(row.hash) !== event.hash ||
        (event.eventKind === "SEMANTIC" &&
          (String(row.semantic_identity) !== event.semanticIdentity ||
            String(row.independence_group_id) !== event.independenceGroupId)) ||
        (event.eventKind === "RELATION" &&
          (row.semantic_identity !== null || row.independence_group_id !== null))
      ) {
        throw new Error("research memory persisted row integrity violation");
      }
      return event;
    });

    return replayResearchMemoryOverlayEvents(records);
  }

  listSemantic(): readonly ResearchMemorySemanticEvent[] {
    return Object.freeze(
      this.list().filter(
        (event): event is ResearchMemorySemanticEvent =>
          event.eventKind === "SEMANTIC"
      )
    );
  }

  listRelations(): readonly ResearchMemoryRelationEvent[] {
    return Object.freeze(
      this.list().filter(
        (event): event is ResearchMemoryRelationEvent =>
          event.eventKind === "RELATION"
      )
    );
  }

  appendSemantic(input: ResearchMemorySemanticInput): ResearchMemorySemanticEvent {
    return this.db.transaction(() => {
      const before = this.list();
      const after = appendResearchMemorySemanticEvent(before, input);
      if (after === before) {
        const identity = researchMemorySemanticEventIdentity(input);
        const existing = before.find(
          (event): event is ResearchMemorySemanticEvent =>
            event.eventKind === "SEMANTIC" && event.identity === identity,
        );
        if (existing == null) {
          throw new Error("semantic memory idempotency resolution failed");
        }
        return existing;
      }
      const event = after.at(-1);
      if (event == null || event.eventKind !== "SEMANTIC") {
        throw new Error("semantic memory append did not produce a semantic event");
      }
      this.insert(event);
      return event;
    });
  }

  appendRelation(input: ResearchMemoryRelationInput): ResearchMemoryRelationEvent {
    return this.db.transaction(() => {
      const before = this.list();
      const after = appendResearchMemoryRelationEvent(before, input);
      if (after === before) {
        const identity = researchMemoryRelationEventIdentity(input);
        const existing = before.find(
          (event): event is ResearchMemoryRelationEvent =>
            event.eventKind === "RELATION" && event.identity === identity,
        );
        if (existing == null) {
          throw new Error("relation memory idempotency resolution failed");
        }
        return existing;
      }
      const event = after.at(-1);
      if (event == null || event.eventKind !== "RELATION") {
        throw new Error("semantic memory append did not produce a relation event");
      }
      this.insert(event);
      return event;
    });
  }

  private insert(event: ResearchMemoryOverlayEvent): void {
    const artifact = primaryArtifact(event);
    this.db.connection.prepare(
      "INSERT INTO research_memory_semantic_events (sequence, event_kind, identity, artifact_kind, artifact_id, artifact_sha256, semantic_identity, independence_group_id, previous_hash, event_json, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      event.sequence,
      event.eventKind,
      event.identity,
      artifact.artifactKind,
      artifact.artifactId,
      artifact.artifactContentSha256,
      event.eventKind === "SEMANTIC" ? event.semanticIdentity : null,
      event.eventKind === "SEMANTIC" ? event.independenceGroupId : null,
      event.previousHash,
      JSON.stringify(event),
      event.hash
    );
  }
}
