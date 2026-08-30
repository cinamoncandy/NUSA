import {
  ResearchTrialLedgerError,
  summarizeResearchTrialLedger,
  verifyResearchTrialLedger,
  type ResearchTrialRecord,
} from "./researchTrialLedger";

export interface ResearchTrialLedgerCheckpoint {
  readonly schemaVersion: 1;
  readonly trialCount: number;
  readonly terminalRecordHash: string;
}

const HEX_64 = /^[0-9a-f]{64}$/;
const GENESIS_HASH = "0".repeat(64);
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

export function createResearchTrialLedgerCheckpoint(
  records: readonly ResearchTrialRecord[],
): ResearchTrialLedgerCheckpoint {
  const summary = summarizeResearchTrialLedger(records);
  return freeze({
    schemaVersion: 1,
    trialCount: summary.trialCount,
    terminalRecordHash: summary.terminalRecordHash,
  });
}

export function verifyResearchTrialLedgerExtendsCheckpoint(
  records: readonly ResearchTrialRecord[],
  checkpoint: ResearchTrialLedgerCheckpoint,
): void {
  verifyResearchTrialLedger(records);
  if (checkpoint == null || typeof checkpoint !== "object" || checkpoint.schemaVersion !== 1) {
    throw new ResearchTrialLedgerError(
      "INVALID_LEDGER_CHECKPOINT",
      "research trial ledger checkpoint schema is invalid",
    );
  }
  if (!Number.isSafeInteger(checkpoint.trialCount) || checkpoint.trialCount < 0) {
    throw new ResearchTrialLedgerError(
      "INVALID_LEDGER_CHECKPOINT",
      "research trial ledger checkpoint trialCount must be a non-negative safe integer",
    );
  }
  if (!HEX_64.test(checkpoint.terminalRecordHash)) {
    throw new ResearchTrialLedgerError(
      "INVALID_LEDGER_CHECKPOINT",
      "research trial ledger checkpoint terminalRecordHash must be a lowercase sha256 digest",
    );
  }
  if (checkpoint.trialCount === 0 && checkpoint.terminalRecordHash !== GENESIS_HASH) {
    throw new ResearchTrialLedgerError(
      "INVALID_LEDGER_CHECKPOINT",
      "empty research trial ledger checkpoint must use the genesis hash",
    );
  }
  if (records.length < checkpoint.trialCount) {
    throw new ResearchTrialLedgerError(
      "LEDGER_HISTORY_TRUNCATED",
      `research trial ledger contains ${records.length} records but checkpoint requires at least ${checkpoint.trialCount}`,
    );
  }
  const checkpointHash = checkpoint.trialCount === 0
    ? GENESIS_HASH
    : records[checkpoint.trialCount - 1]?.recordHash;
  if (checkpointHash !== checkpoint.terminalRecordHash) {
    throw new ResearchTrialLedgerError(
      "LEDGER_HISTORY_DIVERGED",
      "research trial ledger no longer contains the checkpointed evidence prefix",
    );
  }
}
