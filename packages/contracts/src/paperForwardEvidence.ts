export type PaperForwardPeriodStatus = "COMPLETED" | "REJECTED" | "HALTED";

/**
 * Candidate-bound PAPER outcome evidence. This contract contains no account, credential, order,
 * or broker identifiers. A period is admissible only after its server-owned provenance and
 * realized outcome have both been validated by the existing research admission gate.
 */
export interface PaperForwardPeriodEvidence {
  readonly periodId: string;
  readonly candidateId: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
  readonly advisoryGeneratedAt: number;
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly grossReturn: number;
  readonly turnover: number;
  readonly feeRate: number;
  readonly spreadRate: number;
  readonly slippageRate: number;
  readonly status: PaperForwardPeriodStatus;
}
