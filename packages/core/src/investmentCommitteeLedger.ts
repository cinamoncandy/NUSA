import { createHash } from "node:crypto";

export interface RecordedCommitteeDecision {
  readonly outcome: string;
  readonly confidence: number;
  readonly edge: number;
  readonly risk: number;
  readonly reasons: readonly string[];
  readonly decidedAt: number;
}

export interface CommitteeLedgerRecord {
  readonly sequence: number;
  readonly previousHash: string;
  readonly decision: RecordedCommitteeDecision;
  readonly hash: string;
}

const zero = "0".repeat(64);
const hashRecord = (sequence: number, previousHash: string, decision: RecordedCommitteeDecision) =>
  createHash("sha256").update(`${sequence}\n${previousHash}\n${JSON.stringify(decision)}`).digest("hex");

export function appendCommitteeLedger(
  records: readonly CommitteeLedgerRecord[],
  decision: RecordedCommitteeDecision,
): readonly CommitteeLedgerRecord[] {
  replayCommitteeLedger(records);
  const previousHash = records.at(-1)?.hash ?? zero;
  return Object.freeze([
    ...records,
    Object.freeze({
      sequence: records.length + 1,
      previousHash,
      decision: Object.freeze({ ...decision, reasons: Object.freeze([...decision.reasons]) }),
      hash: hashRecord(records.length + 1, previousHash, decision),
    }),
  ]);
}

export function replayCommitteeLedger(records: readonly CommitteeLedgerRecord[]): string {
  let previousHash = zero;
  let lastDecidedAt = -1;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (
      record.sequence !== index + 1
      || record.previousHash !== previousHash
      || record.hash !== hashRecord(record.sequence, record.previousHash, record.decision)
      || record.decision.decidedAt < lastDecidedAt
    ) {
      throw new Error("committee ledger integrity violation");
    }
    previousHash = record.hash;
    lastDecidedAt = record.decision.decidedAt;
  }
  return previousHash;
}
