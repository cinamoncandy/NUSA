import type { ResearchHypothesisEvent, ResearchHypothesisEventType, ResearchHypothesisLifecycleState } from "../../contracts/src/researchMemoryLifecycle";
import { appendResearchHypothesisEvent, replayResearchHypothesisEvents } from "../../contracts/src/researchMemoryLifecycle";
import type { DatabaseSync } from "node:sqlite";

export interface ResearchHypothesisLifecycleDatabase { readonly connection: DatabaseSync; transaction<T>(fn: () => T): T; }

export class SqliteResearchHypothesisLifecycleRepository {
  public constructor(private readonly db: ResearchHypothesisLifecycleDatabase) {}
  public append(input: Omit<ResearchHypothesisEvent, "sequence" | "previousHash" | "hash">): ResearchHypothesisEvent {
    return this.db.transaction(() => {
      const records = this.list();
      const next = appendResearchHypothesisEvent(records, input);
      const event = next.at(-1)!;
      this.db.connection.prepare("INSERT INTO research_hypothesis_events(sequence, hypothesis_id, event_type, title, statement, occurred_at, previous_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(event.sequence, event.hypothesisId, event.type, event.title, event.statement, event.occurredAt, event.previousHash, event.hash);
      return event;
    });
  }
  public list(): readonly ResearchHypothesisEvent[] {
    const rows = this.db.connection.prepare("SELECT sequence, hypothesis_id, event_type, title, statement, occurred_at, previous_hash, hash FROM research_hypothesis_events ORDER BY sequence ASC").all() as Array<Record<string, unknown>>;
    const records = rows.map((row) => Object.freeze({ sequence: Number(row.sequence), hypothesisId: String(row.hypothesis_id), type: String(row.event_type) as ResearchHypothesisEventType, title: String(row.title), statement: String(row.statement), occurredAt: String(row.occurred_at), previousHash: String(row.previous_hash), hash: String(row.hash) }));
    replayResearchHypothesisEvents(records);
    return Object.freeze(records);
  }
  public current(hypothesisId: string): ResearchHypothesisLifecycleState | undefined { return replayResearchHypothesisEvents(this.list()).get(hypothesisId); }
}
