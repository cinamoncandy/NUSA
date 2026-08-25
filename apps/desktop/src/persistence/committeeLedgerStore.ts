import type { DatabaseSync } from "node:sqlite";
import { replayCommitteeLedger, type CommitteeLedgerRecord, type RecordedCommitteeDecision } from "../../../cloud/src/investmentCommitteeLedger";

/** Reads the existing append-only committee ledger without creating or mutating it. */
export function loadCommitteeDashboardSource(db: DatabaseSync): Readonly<{ decision: RecordedCommitteeDecision | null; integrity: "VALID" | "UNAVAILABLE" | "INVALID" }> {
  try {
    const rows = db.prepare("SELECT sequence, previous_hash, decision_json, hash FROM investment_committee_events ORDER BY sequence ASC").all() as Array<Record<string, unknown>>;
    if (rows.length === 0) return Object.freeze({ decision: null, integrity: "UNAVAILABLE" as const });
    const records = rows.map((row) => Object.freeze({ sequence: Number(row.sequence), previousHash: String(row.previous_hash), decision: JSON.parse(String(row.decision_json)) as RecordedCommitteeDecision, hash: String(row.hash) })) as readonly CommitteeLedgerRecord[];
    replayCommitteeLedger(records);
    return Object.freeze({ decision: records[records.length - 1]!.decision, integrity: "VALID" as const });
  } catch {
    return Object.freeze({ decision: null, integrity: "INVALID" as const });
  }
}
