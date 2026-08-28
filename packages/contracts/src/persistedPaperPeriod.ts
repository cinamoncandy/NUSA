import type { LeagueCapitalAllocationAdvisory } from "./leagueCapitalAllocation";

export type PaperPeriodLifecycleStatus = "COMPLETED" | "REJECTED" | "HALTED";

/** Cost data must be attributable to a canonical PAPER execution receipt. */
export type PaperPeriodCostEvidenceKind = "OBSERVED" | "CONSERVATIVE_MODEL";

/** Cost data must identify the source evidence without carrying raw execution payloads. */
export interface PaperPeriodCostEvidence {
  readonly evidenceId: string;
  readonly source: "PAPER_EXECUTION_RECEIPT";
  /** Whether execution-cost components were observed or came from an approved model. */
  readonly evidenceKind: PaperPeriodCostEvidenceKind;
  /** Stable digest of the source evidence set; raw cost payloads never enter the period record. */
  readonly evidenceFingerprintSha256: string;
  readonly observedAt: number;
  readonly feeRate: number;
  readonly spreadRate: number;
  readonly slippageRate: number;
}

export interface PersistedPaperCandidateProvenance {
  readonly candidateId: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
}

export interface PersistedPaperPeriodRecord {
  readonly recordId: string;
  readonly periodIndex: number;
  /** Canonical market identity for benchmark evidence; legacy manual records may omit it. */
  readonly market?: string;
  readonly advisory: LeagueCapitalAllocationAdvisory;
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly realizedReturns: Readonly<Record<string, number>>;
  readonly benchmarkReturn: number;
  readonly turnoverCostRate: number;
  readonly costEvidence: PaperPeriodCostEvidence;
  /** Optional canonical benchmark provenance; legacy records may omit it. */
  readonly benchmarkEvidenceId?: string;
  /** Fingerprint of the canonical account outcome used to derive this period. */
  readonly canonicalOutcomeReceiptFingerprint?: string;
  readonly status: PaperPeriodLifecycleStatus;
}

export interface PersistedPaperPeriodEnvelope {
  readonly record: PersistedPaperPeriodRecord;
  readonly candidateProvenance: readonly PersistedPaperCandidateProvenance[];
}
