import { canonicalResearchJson, type ResearchComparisonEvidence } from "../../../packages/contracts/src/researchRuntime";
import { researchHardeningHash, validateResearchProvenance, validateResearchTemporalIntegrity, type ResearchCandidateGateDecision, type ResearchProvenance } from "../../../packages/contracts/src/researchHardening";
import { validateResearchCostEvidence } from "./researchCostEvidence";

export interface ResearchCandidateGateOptions {
  readonly minimumObservationDays?: number;
  readonly minimumTradeCount?: number;
  readonly minimumIndependentWindows?: number;
  readonly maximumInconclusiveRate?: number;
  readonly minimumStatisticalConfidence?: number;
  readonly minimumSuperiorityMargin?: number;
  readonly nowMs?: number;
  readonly clock?: () => number;
  readonly maxEvidenceAgeMs?: number;
}

export interface ResearchCandidateGateInput {
  readonly candidateId: string;
  readonly evidence: readonly ResearchComparisonEvidence[];
  readonly ledgerIntegrity?: boolean;
  readonly provenance?: readonly ResearchProvenance[];
}

const metrics = ["netReturn", "costAdjustedReturn", "maximumDrawdown", "sharpeRatio", "executionQuality", "unresolvedFaultCount", "dataQualityFailures", "tradeCount"] as const;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const validTimestamp = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function deriveResearchCandidateId(sessionId: string, strategyId: string, strategyVersion: string): string {
  return `candidate-${researchHardeningHash({ sessionId, strategyId, strategyVersion }).slice(0, 48)}`;
}

function sameEvidenceProvenance(left: ResearchProvenance, right: ResearchProvenance): boolean {
  return left.researchRunId === right.researchRunId
    && left.evaluationId === right.evaluationId
    && left.canonicalInputHash === right.canonicalInputHash
    && left.datasetId === right.datasetId
    && left.datasetContentSha256 === right.datasetContentSha256
    && left.strategyId === right.strategyId
    && left.strategyVersion === right.strategyVersion
    && left.experimentFamilyId === right.experimentFamilyId
    && left.windowId === right.windowId
    && left.windowRole === right.windowRole
    && left.splitHash === right.splitHash;
}

function reject(reasons: readonly string[], evidence: unknown): ResearchCandidateGateDecision {
  const normalizedReasons = Object.freeze([...new Set(reasons)].sort());
  let evidenceHash: string;
  try {
    evidenceHash = researchHardeningHash(evidence);
  } catch {
    evidenceHash = researchHardeningHash({ invalidEvidence: true, reasons: normalizedReasons });
  }
  return Object.freeze({ status: "NOT_ELIGIBLE", reasons: normalizedReasons, candidateAuthority: "PAPER_ONLY", automaticPromotion: false, evidenceHash });
}

export class ResearchCandidateGate {
  private readonly options: Required<ResearchCandidateGateOptions>;
  public constructor(options: ResearchCandidateGateOptions = {}) {
    this.options = {
      minimumObservationDays: options.minimumObservationDays ?? 30,
      minimumTradeCount: options.minimumTradeCount ?? 50,
      minimumIndependentWindows: options.minimumIndependentWindows ?? 2,
      maximumInconclusiveRate: options.maximumInconclusiveRate ?? 0.2,
      minimumStatisticalConfidence: options.minimumStatisticalConfidence ?? 0.95,
      minimumSuperiorityMargin: options.minimumSuperiorityMargin ?? 0,
      nowMs: options.nowMs ?? Date.now(),
      clock: options.clock ?? (() => options.nowMs ?? Date.now()),
      maxEvidenceAgeMs: options.maxEvidenceAgeMs ?? 86_400_000
    };
  }

  public evaluate(input: ResearchCandidateGateInput): ResearchCandidateGateDecision {
    const reasons: string[] = [];
    const nowMs = this.options.clock();
    if (!validTimestamp(nowMs)) reasons.push("INVALID_GATE_CLOCK");
    if (typeof input.candidateId !== "string" || input.candidateId.trim() === "") reasons.push("MISSING_CANDIDATE_ID");
    if (input.ledgerIntegrity === false) reasons.push("LEDGER_INTEGRITY_FAILED");
    if (!Array.isArray(input.evidence) || input.evidence.length === 0) reasons.push("MISSING_EVIDENCE");
    const evidence = [...(input.evidence ?? [])].sort((a, b) => a.evaluationId.localeCompare(b.evaluationId));
    const provenance = input.provenance ?? evidence.map((item) => item.provenance).filter((item): item is ResearchProvenance => item != null);
    const provenanceErrors = provenance.flatMap((item) => validateResearchProvenance(item));
    if (provenance.length !== evidence.length) reasons.push("INCOMPLETE_PROVENANCE");
    reasons.push(...provenanceErrors);
    reasons.push(...validateResearchTemporalIntegrity(provenance));
    const windows = new Set(provenance.map((item) => item.windowId));
    if (windows.size < this.options.minimumIndependentWindows) reasons.push("INSUFFICIENT_INDEPENDENT_WINDOWS");
    const holdouts = provenance.filter((item) => item.windowRole === "HOLDOUT");
    if (holdouts.length === 0) reasons.push("HOLDOUT_REQUIRED");
    if (holdouts.some((item) => item.finalHoldoutUntouched !== true)) reasons.push("HOLDOUT_CONTAMINATED");
    const holdoutHashes = new Set(holdouts.map((item) => item.splitHash));
    if (holdoutHashes.size !== holdouts.length) reasons.push("HOLDOUT_REUSED");
    const splitHashes = provenance.map((item) => item.splitHash);
    if (new Set(splitHashes).size !== splitHashes.length && holdouts.length > 0) reasons.push("HOLDOUT_REUSED");
    const finalHoldoutHashes = new Set(provenance.map((item) => item.finalHoldoutWindowHash));
    if (provenance.some((item) => item.attempt > 1) && finalHoldoutHashes.size < provenance.length) reasons.push("CONTAMINATED_FINAL_HOLDOUT");
    if (new Set(provenance.map((item) => item.experimentFamilyId)).size !== 1) reasons.push("EXPERIMENT_FAMILY_MISMATCH");
    if (evidence.some((item) => item.result === "INCONCLUSIVE")) reasons.push("INCONCLUSIVE_EVIDENCE");
    const inconclusiveRate = evidence.length === 0 ? 1 : evidence.filter((item) => item.result === "INCONCLUSIVE").length / evidence.length;
    if (inconclusiveRate > this.options.maximumInconclusiveRate) reasons.push("INCONCLUSIVE_RATE_TOO_HIGH");
    for (const item of evidence) {
      if (item.productionMutationAllowed !== false || item.promotionAllowed !== false) reasons.push("AUTHORITY_VIOLATION");
      if (item.champion == null || item.challenger == null) { reasons.push("MISSING_EVALUATION_SIDE"); continue; }
      if (item.champion.authority !== "PAPER_ONLY" || item.challenger.authority !== "ZERO_AUTHORITY") reasons.push("UNKNOWN_AUTHORITY_STATE");
      if (item.costEvidence == null) {
        reasons.push("MISSING_COST_EVIDENCE");
      } else {
        const costDecision = validateResearchCostEvidence(item.costEvidence, item.evaluationTimestamp);
        reasons.push(...costDecision.reasons.map((value) => `COST_EVIDENCE_${value}`));
        if (item.costEvidence.evaluationId !== item.evaluationId) reasons.push("COST_EVIDENCE_EVALUATION_MISMATCH");
        if (item.provenance != null && (
          item.costEvidence.datasetId !== item.provenance.datasetId
          || item.costEvidence.datasetContentSha256 !== item.provenance.datasetContentSha256
        )) reasons.push("COST_EVIDENCE_PROVENANCE_MISMATCH");
        if (finite(item.costEvidence.netReturn) && finite(item.challenger.metrics.costAdjustedReturn)
          && Math.abs(item.costEvidence.netReturn - item.challenger.metrics.costAdjustedReturn) > 1e-12) {
          reasons.push("COST_EVIDENCE_RETURN_MISMATCH");
        }
      }
      if (item.provenance == null) {
        reasons.push("MISSING_EVIDENCE_PROVENANCE");
      } else if (!provenance.some((value) => sameEvidenceProvenance(value, item.provenance!))) {
        reasons.push("PROVENANCE_EVIDENCE_MISMATCH");
      }
      if (!validTimestamp(item.evaluationTimestamp)) reasons.push("INVALID_EVALUATION_TIMESTAMP");
      else if (validTimestamp(nowMs) && item.evaluationTimestamp > nowMs) reasons.push("FUTURE_EVALUATION_TIMESTAMP");
      for (const metric of metrics) if (!finite(item.champion.metrics[metric]) || !finite(item.challenger.metrics[metric])) reasons.push(`MISSING_METRIC_${metric.toUpperCase()}`);
      if (item.challenger.metrics.unresolvedFaultCount > 0) reasons.push("UNRESOLVED_FAULT");
      if (item.challenger.metrics.dataQualityFailures > 0) reasons.push("DATA_QUALITY_FAILURE");
      if (item.challenger.metrics.tradeCount < this.options.minimumTradeCount) reasons.push("INSUFFICIENT_TRADES");
      const observationDays = item.challenger.metrics.observationDays;
      if (!finite(observationDays) || observationDays < this.options.minimumObservationDays) reasons.push("INSUFFICIENT_OBSERVATION_DAYS");
      if (item.challenger.metrics.maximumDrawdown > item.champion.metrics.maximumDrawdown) reasons.push("DRAWDOWN_NON_REGRESSION_FAILED");
      if (item.challenger.metrics.sharpeRatio < item.champion.metrics.sharpeRatio) reasons.push("RISK_ADJUSTED_NON_SUPERIOR");
      if (item.challenger.metrics.costAdjustedReturn - item.champion.metrics.costAdjustedReturn < this.options.minimumSuperiorityMargin) reasons.push("COST_ADJUSTED_MARGIN_NOT_MET");
      if (!finite(item.challenger.metrics.statisticalConfidence) || item.challenger.metrics.statisticalConfidence < 0.95) reasons.push("STATISTICAL_CONFIDENCE_NOT_MET");
      if (!finite(item.challenger.metrics.superiorityMargin) || item.challenger.metrics.superiorityMargin < this.options.minimumSuperiorityMargin) reasons.push("SUPERIORITY_MARGIN_NOT_MET");
      if (item.result !== "CHALLENGER_BETTER") reasons.push("CHALLENGER_NOT_SUPERIOR");
      if (validTimestamp(item.evaluationTimestamp) && validTimestamp(nowMs) && item.evaluationTimestamp <= nowMs && nowMs - item.evaluationTimestamp > this.options.maxEvidenceAgeMs) reasons.push("STALE_EVIDENCE");
    }
    if (holdouts.some((item) => item.finalHoldoutUntouched !== true)) reasons.push("FINAL_HOLDOUT_NOT_UNTOUCHED");
    const distinctInputs = new Set(evidence.map((item) => item.canonicalInputHash));
    if (distinctInputs.size !== evidence.length) reasons.push("DUPLICATE_EVALUATION_INPUT");
    const eligible = reasons.length === 0;
    return eligible
      ? Object.freeze({ status: "ELIGIBLE", reasons: Object.freeze([]), candidateAuthority: "PAPER_ONLY", automaticPromotion: false, evidenceHash: researchHardeningHash(evidence.map((item) => JSON.parse(canonicalResearchJson(item)))) })
      : reject(reasons, evidence);
  }
}
