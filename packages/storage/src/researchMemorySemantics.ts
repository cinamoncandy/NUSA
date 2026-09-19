import type { DatabaseSync } from "node:sqlite";
import {
  appendResearchMemorySemanticEvent,
  replayResearchMemorySemanticEvents,
  type ResearchMemorySemanticEvent,
  type ResearchMemorySemanticInput
} from "@nusa/contracts";

export interface ResearchSemanticMemoryDatabase {
  readonly connection: DatabaseSync;
  transaction<T>(fn: () => T): T;
}

const decode = (row: Record<string, unknown>): ResearchMemorySemanticEvent =>
  JSON.parse(String(row.event_json)) as ResearchMemorySemanticEvent;

export class SqliteResearchSemanticMemoryRepository {
  constructor(private readonly db: ResearchSemanticMemoryDatabase) {}

  list(): readonly ResearchMemorySemanticEvent[] {
    const records = (this.db.connection.prepare(
      "SELECT event_json FROM research_memory_semantic_events ORDER BY sequence ASC"
    ).all() as Record<string, unknown>[]).map(decode);
    return replayResearchMemorySemanticEvents(records);
  }

  append(input: ResearchMemorySemanticInput): ResearchMemorySemanticEvent {
    return this.db.transaction(() => {
      const before = this.list();
      const after = appendResearchMemorySemanticEvent(before, input);
      if (after === before) {
        const identity = before.find((event) =>
          event.artifactSha256 === input.artifactSha256 &&
          event.semanticIdentity === input.semanticIdentity
        );
        if (!identity) throw new Error("semantic memory idempotency resolution failed");
        return identity;
      }
      const event = after.at(-1)!;
      this.db.connection.prepare(
        "INSERT INTO research_memory_semantic_events (sequence, identity, artifact_sha256, semantic_identity, independence_group_id, previous_hash, event_json, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(event.sequence, event.identity, event.artifactSha256, event.semanticIdentity, event.independenceGroupId, event.previousHash, JSON.stringify(event), event.hash);
      return event;
    });
  }
}
