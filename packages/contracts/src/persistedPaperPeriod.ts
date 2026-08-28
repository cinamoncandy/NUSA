import type { LeagueCapitalAllocationAdvisory } from "./leagueCapitalAllocation";

export type PaperPeriodLifecycleStatus = "COMPLETED" | "REJECTED" | "HALTED";

/** Cost data must be attributable to a canonical PAPER execution receipt. */
export interface PaperPeriodCostEvidence {
  readonly evidenceId: string;
  readonly source: "PAPER_EXECUTION_RECEIPT";
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
  readonly advisory: LeagueCapitalAllocationAdvisory;
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly realizedReturns: Readonly<Record<string, number>>;
  readonly benchmarkReturn: number;
  readonly turnoverCostRate: number;
  readonly costEvidence: PaperPeriodCostEvidence;
  readonly status: PaperPeriodLifecycleStatus;
}

export interface PersistedPaperPeriodEnvelope {
  readonly record: PersistedPaperPeriodRecord;
  readonly candidateProvenance: readonly PersistedPaperCandidateProvenance[];
}
