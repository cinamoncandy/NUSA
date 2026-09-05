import type { PaperForwardPeriodEvidence } from "../../../packages/contracts/src/paperForwardEvidence";
import type { PaperPerformanceSummary } from "../../../packages/contracts/src/strategyGovernance";
import { buildCanonicalPaperCandidatePerformance, type CanonicalPaperExecutionQualityPolicy } from "./canonicalPaperCandidatePerformance";
import type { PaperAccountState } from "./paperTradingExecutionLoop";

export interface CanonicalPaperCandidateForwardEvidenceReader {
  read(candidateId: string): readonly PaperForwardPeriodEvidence[] | undefined;
}

export interface CanonicalPaperCandidatePerformanceSourceOptions {
  readonly periods: CanonicalPaperCandidateForwardEvidenceReader;
  readonly readCanonicalPaperAccount: () => PaperAccountState | undefined;
  readonly executionQualityPolicy: CanonicalPaperExecutionQualityPolicy;
}

/**
 * Read-only source for the existing canonical `PaperPerformanceSummary` contract.
 * It never derives a candidate from aggregate account PnL: the candidate-specific forward-period
 * reader must already have passed the provenance/chronology admission boundary. The exact
 * production PAPER account then contributes only candidate-bound canonical fills/orders.
 */
export class CanonicalPaperCandidatePerformanceSource {
  public constructor(private readonly options: CanonicalPaperCandidatePerformanceSourceOptions) {}

  public read(candidateId: string): PaperPerformanceSummary | undefined {
    const normalized = candidateId.trim();
    if (!normalized) throw new Error("candidateId is required");
    const periods = this.options.periods.read(normalized);
    if (periods == null || periods.length === 0) return undefined;
    const account = this.options.readCanonicalPaperAccount();
    if (account == null) return undefined;
    return buildCanonicalPaperCandidatePerformance({
      candidateId: normalized,
      periods,
      account,
      executionQualityPolicy: this.options.executionQualityPolicy,
    });
  }
}
