import type { PaperScenarioEvent, PaperScenarioRecord, PaperScenarioEvidenceSummary } from "../../contracts/src/persistenceLedger";
import { appendPaperScenarioEvent, replayPaperScenarioEvidence } from "../../contracts/src/persistenceLedger";

export interface EvidenceDatabase { readonly connection: { exec(sql: string): unknown; prepare(sql: string): { all(...args: unknown[]): unknown[]; run(...args: unknown[]): unknown; }; }; transaction<T>(fn: () => T): T; }

export class SqlitePaperScenarioEvidenceStore {
  public constructor(private readonly db: EvidenceDatabase) {
    db.connection.exec("CREATE TABLE IF NOT EXISTS paper_scenario_evidence (sequence INTEGER PRIMARY KEY, previous_hash TEXT NOT NULL, event_json TEXT NOT NULL, hash TEXT NOT NULL UNIQUE)");
  }

  public list(): readonly PaperScenarioRecord[] {
    const rows = this.db.connection.prepare("SELECT sequence, previous_hash, event_json, hash FROM paper_scenario_evidence ORDER BY sequence ASC").all() as Array<Record<string, unknown>>;
    return Object.freeze(rows.map((row) => Object.freeze({ sequence: Number(row.sequence), previousHash: String(row.previous_hash), event: JSON.parse(String(row.event_json)) as PaperScenarioEvent, hash: String(row.hash) })));
  }

  public append(event: PaperScenarioEvent): PaperScenarioRecord {
    return this.db.transaction(() => {
      const next = appendPaperScenarioEvent(this.list(), event).at(-1)!;
      this.db.connection.prepare("INSERT INTO paper_scenario_evidence (sequence, previous_hash, event_json, hash) VALUES (?, ?, ?, ?)").run(next.sequence, next.previousHash, JSON.stringify(next.event), next.hash);
      return next;
    });
  }

  public replay(): PaperScenarioEvidenceSummary { return replayPaperScenarioEvidence(this.list()); }
  public verify(): void { replayPaperScenarioEvidence(this.list()); }
}
