import { createHash } from "node:crypto";

export type PaperCalibrationEvidenceStatus = "VERIFIED" | "INSUFFICIENT" | "UNKNOWN" | "CONFLICTING";
export type PaperCalibrationDecision = "CALIBRATED" | "ABSTAIN";
export type PaperConfidenceAction = "REDUCE" | "HOLD" | "ALLOW_INCREASE_WITH_NEW_INDEPENDENT_EVIDENCE";

export interface VerifiedPaperOutcomeObservation {
  readonly periodId: string;
  readonly candidateId: string;
  readonly strategyFamilyId: string;
  readonly regime: string;
  readonly predictedSuccessProbability: number;
  readonly expectedNetEdge: number;
  readonly realizedNetReturn: number;
  readonly realizedSuccess: boolean;
  readonly observedAt: string;
  readonly outcomeFingerprintSha256: string;
  readonly evidenceStatus: PaperCalibrationEvidenceStatus;
  readonly source: "PAPER";
  readonly independentEvidenceId: string;
}

export interface PaperOutcomeCalibrationInput {
  readonly calibrationId: string;
  readonly candidateId: string;
  readonly strategyFamilyId: string;
  readonly regime: string;
  readonly evaluatedAt: string;
  readonly maximumEvidenceAgeMs: number;
  readonly minimumVerifiedPeriods: number;
  readonly overconfidenceTolerance: number;
  readonly priorIndependentEvidenceCount: number;
  readonly observations: readonly VerifiedPaperOutcomeObservation[];
}

export interface PaperOutcomeCalibrationResult {
  readonly calibrationId: string;
  readonly decision: PaperCalibrationDecision;
  readonly confidenceAction: PaperConfidenceAction;
  readonly reasons: readonly string[];
  readonly candidateId: string;
  readonly strategyFamilyId: string;
  readonly regime: string;
  readonly verifiedPeriods: number;
  readonly independentEvidenceCount: number;
  readonly empiricalSuccessRate: number | null;
  readonly meanPredictedSuccessProbability: number | null;
  readonly brierScore: number | null;
  readonly meanExpectedNetEdge: number | null;
  readonly meanRealizedNetReturn: number | null;
  readonly calibrationGap: number | null;
  readonly evidenceFingerprintSha256: string | null;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

const sha256 = /^[a-f0-9]{64}$/i;
const freeze = <T>(value: T): T => Object.freeze(value);
const finite = (value: number, label: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
};
const ratio = (value: number, label: string): void => {
  finite(value, label);
  if (value < 0 || value > 1) throw new Error(`${label} must be between 0 and 1`);
};
const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    finite(value, "calibration evidence number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  throw new Error("unsupported calibration evidence value");
}

const digest = (value: unknown): string => createHash("sha256").update(canonical(value), "utf8").digest("hex");

function validateInput(input: PaperOutcomeCalibrationInput): number {
  if (!input.calibrationId.trim() || !input.candidateId.trim() || !input.strategyFamilyId.trim() || !input.regime.trim()) {
    throw new Error("calibration identity is required");
  }
  const evaluatedAtMs = Date.parse(input.evaluatedAt);
  if (!Number.isFinite(evaluatedAtMs)) throw new Error("evaluatedAt must be a valid ISO timestamp");
  if (!Number.isSafeInteger(input.minimumVerifiedPeriods) || input.minimumVerifiedPeriods <= 0) throw new Error("minimumVerifiedPeriods must be a positive integer");
  if (!Number.isFinite(input.maximumEvidenceAgeMs) || input.maximumEvidenceAgeMs < 0) throw new Error("maximumEvidenceAgeMs must be non-negative");
  ratio(input.overconfidenceTolerance, "overconfidenceTolerance");
  if (!Number.isSafeInteger(input.priorIndependentEvidenceCount) || input.priorIndependentEvidenceCount < 0) throw new Error("priorIndependentEvidenceCount must be a non-negative integer");
  return evaluatedAtMs;
}

function validateObservation(observation: VerifiedPaperOutcomeObservation): void {
  if (!observation.periodId.trim() || !observation.candidateId.trim() || !observation.strategyFamilyId.trim() || !observation.regime.trim() || !observation.independentEvidenceId.trim()) {
    throw new Error("PAPER outcome identity is incomplete");
  }
  ratio(observation.predictedSuccessProbability, "predictedSuccessProbability");
  finite(observation.expectedNetEdge, "expectedNetEdge");
  finite(observation.realizedNetReturn, "realizedNetReturn");
  if (!Number.isFinite(Date.parse(observation.observedAt))) throw new Error("observedAt must be a valid ISO timestamp");
  if (!sha256.test(observation.outcomeFingerprintSha256)) throw new Error("outcomeFingerprintSha256 must be sha256");
  if (observation.source !== "PAPER") throw new Error("only PAPER outcome evidence may calibrate PAPER confidence");
}

export function calibratePaperOutcomes(input: PaperOutcomeCalibrationInput): PaperOutcomeCalibrationResult {
  const evaluatedAtMs = validateInput(input);
  const reasons: string[] = [];
  const periodIds = new Set<string>();
  const fingerprints = new Set<string>();
  const independentEvidenceIds = new Set<string>();
  const verified: VerifiedPaperOutcomeObservation[] = [];

  for (const observation of input.observations) {
    validateObservation(observation);
    if (observation.candidateId !== input.candidateId || observation.strategyFamilyId !== input.strategyFamilyId) {
      reasons.push("CANDIDATE_IDENTITY_MISMATCH");
      continue;
    }
    if (observation.regime !== input.regime) {
      reasons.push("REGIME_EVIDENCE_MISMATCH");
      continue;
    }
    if (periodIds.has(observation.periodId) || fingerprints.has(observation.outcomeFingerprintSha256)) {
      reasons.push("DUPLICATE_OR_REPLAYED_OUTCOME");
      continue;
    }
    periodIds.add(observation.periodId);
    fingerprints.add(observation.outcomeFingerprintSha256);
    if (independentEvidenceIds.has(observation.independentEvidenceId)) {
      reasons.push("NON_INDEPENDENT_EVIDENCE_REUSE");
      continue;
    }
    independentEvidenceIds.add(observation.independentEvidenceId);

    const observedAtMs = Date.parse(observation.observedAt);
    if (observedAtMs > evaluatedAtMs) {
      reasons.push("FUTURE_EVIDENCE");
      continue;
    }
    if (evaluatedAtMs - observedAtMs > input.maximumEvidenceAgeMs) {
      reasons.push("STALE_EVIDENCE");
      continue;
    }
    if (observation.evidenceStatus !== "VERIFIED") {
      reasons.push(`EVIDENCE_${observation.evidenceStatus}`);
      continue;
    }
    verified.push(observation);
  }

  if (verified.length < input.minimumVerifiedPeriods) reasons.push("INSUFFICIENT_LONGITUDINAL_PAPER_EVIDENCE");
  const hardFail = reasons.length > 0;
  const independentEvidenceCount = new Set(verified.map((item) => item.independentEvidenceId)).size;

  let empiricalSuccessRate: number | null = null;
  let meanPredictedSuccessProbability: number | null = null;
  let brierScore: number | null = null;
  let meanExpectedNetEdge: number | null = null;
  let meanRealizedNetReturn: number | null = null;
  let calibrationGap: number | null = null;
  let confidenceAction: PaperConfidenceAction = "HOLD";
  let evidenceFingerprintSha256: string | null = null;

  if (!hardFail && verified.length > 0) {
    empiricalSuccessRate = round(verified.filter((item) => item.realizedSuccess).length / verified.length);
    meanPredictedSuccessProbability = round(verified.reduce((sum, item) => sum + item.predictedSuccessProbability, 0) / verified.length);
    brierScore = round(verified.reduce((sum, item) => {
      const realized = item.realizedSuccess ? 1 : 0;
      return sum + ((item.predictedSuccessProbability - realized) ** 2);
    }, 0) / verified.length);
    meanExpectedNetEdge = round(verified.reduce((sum, item) => sum + item.expectedNetEdge, 0) / verified.length);
    meanRealizedNetReturn = round(verified.reduce((sum, item) => sum + item.realizedNetReturn, 0) / verified.length);
    calibrationGap = round(meanPredictedSuccessProbability - empiricalSuccessRate);

    if (calibrationGap > input.overconfidenceTolerance || meanExpectedNetEdge > meanRealizedNetReturn) {
      confidenceAction = "REDUCE";
    } else if (independentEvidenceCount > input.priorIndependentEvidenceCount) {
      confidenceAction = "ALLOW_INCREASE_WITH_NEW_INDEPENDENT_EVIDENCE";
    }
    evidenceFingerprintSha256 = digest({
      candidateId: input.candidateId,
      strategyFamilyId: input.strategyFamilyId,
      regime: input.regime,
      observations: [...verified]
        .sort((left, right) => left.periodId.localeCompare(right.periodId))
        .map((item) => ({
          periodId: item.periodId,
          predictedSuccessProbability: item.predictedSuccessProbability,
          expectedNetEdge: item.expectedNetEdge,
          realizedNetReturn: item.realizedNetReturn,
          realizedSuccess: item.realizedSuccess,
          observedAt: item.observedAt,
          outcomeFingerprintSha256: item.outcomeFingerprintSha256,
          independentEvidenceId: item.independentEvidenceId,
        })),
    });
  }

  return freeze({
    calibrationId: input.calibrationId,
    decision: hardFail ? "ABSTAIN" : "CALIBRATED",
    confidenceAction: hardFail ? "HOLD" : confidenceAction,
    reasons: freeze([...new Set(reasons)].sort()),
    candidateId: input.candidateId,
    strategyFamilyId: input.strategyFamilyId,
    regime: input.regime,
    verifiedPeriods: verified.length,
    independentEvidenceCount,
    empiricalSuccessRate,
    meanPredictedSuccessProbability,
    brierScore,
    meanExpectedNetEdge,
    meanRealizedNetReturn,
    calibrationGap,
    evidenceFingerprintSha256,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}
