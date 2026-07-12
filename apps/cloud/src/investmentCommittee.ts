import type {
  CommitteeConsensus,
  CommitteeMember,
  CommitteeOpinion,
  CommitteeSafetyContext,
  CommitteeSignal,
  ConflictLevel,
  InvestmentCommitteeResult
} from "../../../packages/contracts/src/investmentCommittee";

export type CommitteeWeights = Readonly<Record<CommitteeMember, number>>;

const SIGNAL_SCORE: Readonly<Record<CommitteeSignal, number>> = Object.freeze({
  BUY: 1,
  HOLD: 0.25,
  WAIT: 0,
  REDUCE: -0.5,
  SELL: -0.75,
  EXIT: -1
});

const assertFinite = (value: number, field: string, minimum?: number, maximum?: number): void => {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite`);
  if (minimum !== undefined && value < minimum) throw new Error(`${field} is below minimum`);
  if (maximum !== undefined && value > maximum) throw new Error(`${field} exceeds maximum`);
};

const assertTime = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
};

const round6 = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

const freezeOpinion = (opinion: CommitteeOpinion): CommitteeOpinion => Object.freeze({
  ...opinion,
  reasons: Object.freeze([...opinion.reasons].map((reason) => reason.trim()).filter(Boolean).sort())
});

const buildVetoReasons = (safety: CommitteeSafetyContext): readonly string[] => {
  const reasons: string[] = [];
  if (safety.killSwitchActive) reasons.push("KILL_SWITCH_ACTIVE");
  if (safety.unresolvedRecovery) reasons.push("UNRESOLVED_RECOVERY");
  if (safety.strategySuspended) reasons.push("STRATEGY_SUSPENDED");
  if (safety.executionQualityScore < safety.minimumExecutionQualityScore) reasons.push("EXECUTION_QUALITY_LOW");
  if (safety.netEdge <= 0) reasons.push("NET_EDGE_NON_POSITIVE");
  if (safety.portfolioHeat > safety.maximumPortfolioHeat) reasons.push("PORTFOLIO_HEAT_HIGH");
  if (safety.drawdown > safety.maximumDrawdown) reasons.push("DRAWDOWN_LIMIT_EXCEEDED");
  if (safety.marginBuffer < safety.minimumMarginBuffer) reasons.push("MARGIN_BUFFER_LOW");
  if (!safety.fundingCarrySafe) reasons.push("FUNDING_CARRY_UNSAFE");
  if (!safety.probabilityFresh) reasons.push("PROBABILITY_STALE");
  if (!safety.featureFingerprintMatches) reasons.push("FEATURE_FINGERPRINT_MISMATCH");
  return Object.freeze(reasons.sort());
};

const conflictLevel = (disagreement: number, vetoCount: number): ConflictLevel => {
  if (vetoCount > 0 || disagreement >= 0.75) return "CRITICAL";
  if (disagreement >= 0.25) return "HIGH";
  if (disagreement >= 0.25) return "MEDIUM";
  return "LOW";
};

export function evaluateInvestmentCommittee(
  opinionsInput: readonly CommitteeOpinion[],
  weights: CommitteeWeights,
  safety: CommitteeSafetyContext,
  decidedAt: number
): InvestmentCommitteeResult {
  assertTime(decidedAt, "decidedAt");
  if (opinionsInput.length === 0) throw new Error("at least one committee opinion is required");

  const seen = new Set<CommitteeMember>();
  const opinions = opinionsInput.map((raw) => {
    if (seen.has(raw.member)) throw new Error(`duplicate committee member: ${raw.member}`);
    seen.add(raw.member);
    assertFinite(raw.confidence, "confidence", 0, 1);
    assertFinite(raw.edge, "edge");
    assertFinite(raw.expectedReturn, "expectedReturn");
    assertFinite(raw.expectedRisk, "expectedRisk", 0);
    assertTime(raw.timeHorizonMs, "timeHorizonMs");
    assertTime(raw.observedAt, "observedAt");
    if (raw.observedAt > decidedAt) throw new Error("committee opinion cannot come from the future");
    return freezeOpinion(raw);
  });

  let totalWeight = 0;
  let signal = 0;
  let confidence = 0;
  let edge = 0;
  let risk = 0;
  const weightedBuckets = new Map<CommitteeSignal, number>();

  for (const opinion of opinions) {
    const weight = weights[opinion.member];
    assertFinite(weight, `weight.${opinion.member}`, 0);
    const effectiveWeight = weight * opinion.confidence;
    totalWeight += effectiveWeight;
    signal += SIGNAL_SCORE[opinion.signal] * effectiveWeight;
    confidence += opinion.confidence * effectiveWeight;
    edge += opinion.edge * effectiveWeight;
    risk += opinion.expectedRisk * effectiveWeight;
    weightedBuckets.set(opinion.signal, (weightedBuckets.get(opinion.signal) ?? 0) + effectiveWeight);
  }
  if (totalWeight <= 0) throw new Error("committee effective weight must be positive");

  const probabilities = [...weightedBuckets.values()].map((value) => value / totalWeight);
  const maxBucket = Math.max(...probabilities);
  const entropyRaw = -probabilities.reduce((sum, probability) => sum + (probability <= 0 ? 0 : probability * Math.log(probability)), 0);
  const entropyMax = probabilities.length <= 1 ? 1 : Math.log(probabilities.length);
  const entropy = round6(entropyRaw / entropyMax);
  const agreementScore = round6(maxBucket);
  const disagreementScore = round6(1 - agreementScore);
  const vetoReasons = buildVetoReasons(safety);
  const consensus: CommitteeConsensus = Object.freeze({
    weightedSignalScore: round6(signal / totalWeight),
    weightedConfidence: round6(confidence / totalWeight),
    weightedEdge: round6(edge / totalWeight),
    weightedRisk: round6(risk / totalWeight),
    agreementScore,
    disagreementScore,
    entropy,
    conflictLevel: conflictLevel(disagreementScore, vetoReasons.length),
    vetoReasons
  });

  const reasons = [...vetoReasons];
  let decision: InvestmentCommitteeResult["decision"];
  if (vetoReasons.includes("KILL_SWITCH_ACTIVE") || vetoReasons.includes("UNRESOLVED_RECOVERY") || vetoReasons.includes("MARGIN_BUFFER_LOW")) {
    decision = "EMERGENCY_EXIT";
  } else if (vetoReasons.length > 0) {
    decision = "REJECT";
  } else if (consensus.conflictLevel === "HIGH" || consensus.conflictLevel === "CRITICAL") {
    decision = "WAIT";
    reasons.push("COMMITTEE_CONFLICT_HIGH");
  } else if (consensus.weightedSignalScore <= -0.5) {
    decision = "REDUCE";
    reasons.push("NEGATIVE_WEIGHTED_SIGNAL");
  } else if (consensus.weightedSignalScore >= 0.55 && consensus.weightedConfidence >= 0.7 && consensus.weightedEdge > 0) {
    decision = consensus.disagreementScore <= 0.2 ? "APPROVE" : "APPROVE_PARTIAL";
    reasons.push("POSITIVE_CONSENSUS");
  } else if (consensus.weightedSignalScore > 0 && consensus.weightedEdge > 0) {
    decision = "PAPER_ONLY";
    reasons.push("EDGE_PRESENT_BUT_CONSENSUS_INSUFFICIENT");
  } else {
    decision = "WAIT";
    reasons.push("NO_ACTIONABLE_CONSENSUS");
  }

  return Object.freeze({ decision, consensus, reasons: Object.freeze(reasons.sort()), decidedAt });
}
