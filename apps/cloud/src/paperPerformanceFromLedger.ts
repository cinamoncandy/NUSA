import type { PaperAccountingProjection } from "./paperAccountingLedger";
import { assertPaperPerformanceLedgerSourceReady } from "./paperPerformanceComparison";
import {
  buildPaperPerformanceEvidence,
  type PaperPerformanceEvidence,
  type PaperPerformanceEvidenceInput
} from "./paperPerformanceEvidence";

export interface PaperPerformanceFromLedgerInput extends Omit<PaperPerformanceEvidenceInput, "sourceLedgerFingerprintSha256"> {
  readonly ledger: PaperAccountingProjection;
  readonly durableCompleteJournal: boolean;
}

export function buildPaperPerformanceEvidenceFromLedger(input: PaperPerformanceFromLedgerInput): PaperPerformanceEvidence {
  assertPaperPerformanceLedgerSourceReady({
    durableCompleteJournal: input.durableCompleteJournal,
    reconciled: true,
    ledgerFingerprintSha256: input.ledger.fingerprintSha256
  });
  return buildPaperPerformanceEvidence({
    ...input,
    sourceLedgerFingerprintSha256: input.ledger.fingerprintSha256
  });
}
