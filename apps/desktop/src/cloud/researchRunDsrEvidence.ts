import type { AbstentionAssessment } from "./abstentionEngine";
import { calculateDeflatedSharpeEvidence, type DeflatedSharpeEvidence } from "./researchSearchAdjustedEvidence";
import { appendResearchTrial, summarizeResearchTrialLedger, type ResearchTrialRecord, type ResearchTrialLedgerSummary } from "./researchTrialLedger";
import { researchRunOosReturns, type ResearchRunPboCandidate } from "./researchRunPboEvidence";

export interface ResearchRunDsrCandidate extends ResearchRunPboCandidate {
  readonly familyId: string;
  /** Existing abstention evidence, when this candidate was withheld from research. */
  readonly abstention?: AbstentionAssessment;
}

export interface ResearchRunDsrEvidenceResult {
  readonly evidenceByCandidate: ReadonlyMap<string, DeflatedSharpeEvidence>;
  readonly unavailableReasons: ReadonlyMap<string, string>;
  /** Immutable search ledger summary, including rejected/failed attempts. */
  readonly trialLedgerSummary: ResearchTrialLedgerSummary;
}

export class ResearchRunDsrEvidenceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ResearchRunDsrEvidenceError";
  }
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function moments(values: readonly number[]): { readonly sharpeRatio: number; readonly skewness: number; readonly kurtosis: number } {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const centered = values.map((value) => value - mean);
  const variance = centered.reduce((sum, value) => sum + value ** 2, 0) / (values.length - 1);
  if (!(variance > 0) || !Number.isFinite(variance)) {
    throw new ResearchRunDsrEvidenceError("ZERO_OOS_RETURN_VARIANCE", "real-run DSR requires non-zero finite OOS return variance");
  }
  const deviation = Math.sqrt(variance);
  const populationVariance = centered.reduce((sum, value) => sum + value ** 2, 0) / values.length;
  const populationDeviation = Math.sqrt(populationVariance);
  const skewness = centered.reduce((sum, value) => sum + (value / populationDeviation) ** 3, 0) / values.length;
  const kurtosis = centered.reduce((sum, value) => sum + (value / populationDeviation) ** 4, 0) / values.length;
  const sharpeRatio = mean / deviation;
  if (![sharpeRatio, skewness, kurtosis].every(Number.isFinite) || kurtosis < 1) {
    throw new ResearchRunDsrEvidenceError("INVALID_OOS_MOMENTS", "real-run DSR OOS moments must be finite with kurtosis of at least one");
  }
  return freeze({ sharpeRatio, skewness, kurtosis });
}

/**
 * Builds candidate-specific DSR evidence from the same cost-aware, window-safe OOS returns used
 * by the real-run PBO adapter. The temporary ledger records every candidate actually evaluated
 * by this run; it does not invent failed attempts or use training returns.
 */
export function buildResearchRunDsrEvidence(candidates: readonly ResearchRunDsrCandidate[]): ResearchRunDsrEvidenceResult {
  if (candidates.length < 2) throw new ResearchRunDsrEvidenceError("INSUFFICIENT_CANDIDATES", "real-run DSR requires at least two candidates");
  const ids = candidates.map((candidate) => candidate.id.trim());
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new ResearchRunDsrEvidenceError("INVALID_CANDIDATE_IDS", "candidate ids must be unique and non-empty");
  }
  const manifest = candidates[0]!.experiment.manifest;
  const searchId = `real-run:${manifest.datasetId}`;
  const series = candidates.map((candidate) => ({ candidate, returns: researchRunOosReturns(candidate) }));
  const reference = series[0]!.returns;
  for (const entry of series.slice(1)) {
    if (entry.returns.length !== reference.length || entry.returns.some((value, index) => value.timestamp !== reference[index]!.timestamp)) {
      throw new ResearchRunDsrEvidenceError("OOS_TIMESTAMP_ALIGNMENT_MISMATCH", "all DSR candidates must describe the same OOS timestamps");
    }
  }
  let ledger: readonly ResearchTrialRecord[] = Object.freeze([]);
  const statisticsByCandidate = new Map<string, ReturnType<typeof moments>>();
  const unavailableReasons = new Map<string, string>();
  for (const [index, entry] of series.entries()) {
    const candidateManifest = entry.candidate.experiment.manifest;
    if (candidateManifest.datasetId !== manifest.datasetId || candidateManifest.contentSha256 !== manifest.contentSha256) {
      throw new ResearchRunDsrEvidenceError("DATASET_PROVENANCE_MISMATCH", "all DSR candidates must use the same verified dataset");
    }
    const abstention = entry.candidate.abstention;
    if (abstention != null) {
      if (abstention.schemaVersion !== 1
        || !Number.isFinite(abstention.asOf)
        || !["PROCEED_RESEARCH", "ABSTAIN"].includes(abstention.decision)
        || !Array.isArray(abstention.sourceDatasetIds)
        || !abstention.sourceDatasetIds.includes(manifest.datasetId)) {
        throw new ResearchRunDsrEvidenceError("INVALID_ABSTENTION_EVIDENCE", "candidate " + entry.candidate.id + " carries invalid or mismatched abstention evidence");
      }
      if (abstention.decision === "ABSTAIN" && (!Array.isArray(abstention.reasons) || abstention.reasons.length === 0)) {
        throw new ResearchRunDsrEvidenceError("INVALID_ABSTENTION_EVIDENCE", "candidate " + entry.candidate.id + " abstention requires at least one reason");
      }
    }
    const isAbstained = abstention?.decision === "ABSTAIN";
    let statistics: ReturnType<typeof moments> | undefined;
    if (isAbstained) {
      // An abstained candidate remains in the search denominator but cannot acquire DSR evidence.
      unavailableReasons.set(entry.candidate.id, "ABSTENTION_DECISION");
    } else {
      try {
        statistics = moments(entry.returns.map((value) => value.value));
        statisticsByCandidate.set(entry.candidate.id, statistics);
      } catch (error) {
        if (!(error instanceof ResearchRunDsrEvidenceError) || error.code !== "ZERO_OOS_RETURN_VARIANCE") throw error;
        unavailableReasons.set(entry.candidate.id, error.code);
      }
    }
    const outcome = isAbstained ? "ABSTAINED" : statistics == null ? "REJECTED" : "COMPLETED";
    ledger = appendResearchTrial(ledger, {
      trialId: entry.candidate.id,
      familyId: entry.candidate.familyId,
      hypothesis: "cost-aware OOS parameter candidate",
      createdAt: entry.candidate.experiment.generatedAt,
      dataset: {
        datasetId: manifest.datasetId,
        contentSha256: manifest.contentSha256,
        market: manifest.market,
        interval: manifest.interval,
      },
      candidateIds: [entry.candidate.id],
      search: { searchId, attemptOrdinal: index + 1 },
      outcome,
      ...(isAbstained
        ? { abstentionReasons: abstention!.reasons }
        : statistics == null ? { rejectionReasons: ["ZERO_OOS_RETURN_VARIANCE"] } : { metrics: { sharpeRatio: statistics.sharpeRatio } }),
      tags: ["COST_AWARE", "OUT_OF_SAMPLE"],
    });
  }
  const evidenceByCandidate = new Map<string, DeflatedSharpeEvidence>();
  for (const entry of series) {
    const values = entry.returns.map((value) => value.value);
    const statistics = statisticsByCandidate.get(entry.candidate.id);
    if (statistics == null) continue;
    try {
      evidenceByCandidate.set(entry.candidate.id, calculateDeflatedSharpeEvidence({
        ledger,
        searchId,
        selectedTrialId: entry.candidate.id,
        sampleLength: values.length,
        skewness: statistics.skewness,
        kurtosis: statistics.kurtosis,
      }));
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : undefined;
      if (code !== "INSUFFICIENT_SHARPE_TRIALS") throw error;
      unavailableReasons.set(entry.candidate.id, code);
    }
  }
  return freeze({ evidenceByCandidate, unavailableReasons, trialLedgerSummary: summarizeResearchTrialLedger(ledger) });
}