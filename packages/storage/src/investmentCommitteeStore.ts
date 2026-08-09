import type { DatabaseSync } from "node:sqlite";
import {
  appendCommitteeLedger,
  replayCommitteeLedger,
  type CommitteeLedgerRecord,
  type RecordedCommitteeDecision,
} from "../../core/src/investmentCommitteeLedger";

export interface CommitteeDb {
  readonly connection: DatabaseSync;
  transaction<T>(fn: () => T): T;
}

export class SqliteInvestmentCommitteeStore {
  constructor(private readonly db: CommitteeDb) {
    db.connection.prepare("SELECT 1 FROM investment_committee_snapshot LIMIT 1").all();
  }

  append(decision: RecordedCommitteeDecision): void {
    this.db.transaction(() => {
      const next = appendCommitteeLedger(this.list(), decision).at(-1)!;
      this.db.connection
        .prepare("INSERT INTO investment_committee_events VALUES(?,?,?,?)")
        .run(next.sequence, next.previousHash, JSON.stringify(next.decision), next.hash);
      this.db.connection
        .prepare("INSERT INTO investment_committee_snapshot VALUES(1,?) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash")
        .run(next.hash);
    });
  }

  list(): readonly CommitteeLedgerRecord[] {
    return Object.freeze(
      (this.db.connection.prepare("SELECT * FROM investment_committee_events ORDER BY sequence").all() as Array<Record<string, unknown>>)
        .map((row) => Object.freeze({
          sequence: Number(row.sequence),
          previousHash: String(row.previous_hash),
          decision: JSON.parse(String(row.decision_json)) as RecordedCommitteeDecision,
          hash: String(row.hash),
        })),
    );
  }

  verify(): void {
    const records = this.list();
    const hash = replayCommitteeLedger(records);
    const row = this.db.connection.prepare("SELECT hash FROM investment_committee_snapshot WHERE id=1").get() as { hash: string } | undefined;
    if (!row) {
      if (records.length === 0) return;
      throw new Error("committee snapshot missing");
    }
    if (row.hash !== hash) throw new Error("committee snapshot mismatch");
  }
}
