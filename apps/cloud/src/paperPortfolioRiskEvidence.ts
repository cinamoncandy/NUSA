import { createHash } from "node:crypto";
import type { PaperChaosTrustedGitHubRunReceipt } from "./paperChaosEvidenceProvenance";

export type PaperPortfolioRiskEvidenceStatus = "VERIFIED" | "INSUFFICIENT" | "UNKNOWN" | "CONFLICTING";
export type PaperPortfolioRiskDecision = "ACCEPT" | "ABSTAIN";

export interface PaperPortfolioTrustedEvidenceRiskFacts {
  readonly candidateId: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
  readonly observedAt: string;
  readonly evaluatedAt: string;
  readonly evidencePeriods: number;
  readonly portfolioDrawdownContribution: number;
  readonly diversificationBenefit: number;
  readonly maximumAbsoluteCandidateCorrelation: number;
  readonly portfolioRegime: string;
  readonly regimeCoFailureRate: number;
  readonly currentPortfolioGrossWeight: number;
  readonly currentStrategyWeight: number;
  readonly estimatedTurnover: number;
  readonly estimatedFeeRate: number;
  readonly estimatedSlippageRate: number;
  readonly grossExpectedEdge: number;
}

export interface PaperPortfolioTrustedLongitudinalEvidence {
  readonly schemaVersion: 1;
  readonly verificationStatus: "VERIFIED";
  readonly verificationSource: "GITHUB_API" | "RUNNER_ATTESTATION";
  readonly repository: string;
  readonly sourceSha: string;
  readonly workflowRunId: number;
  readonly workflowRunAttempt: number;
  readonly workflowRef: string;
  readonly eventName: string;
  readonly workflowRunUrl: string;
  readonly candidateId: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
  readonly periodIds: readonly string[];
  readonly outcomeReceiptFingerprints: readonly string[];
  readonly evidenceFingerprintSha256: string;
  readonly verifiedAt: string;
}

export interface PaperPortfolioTrustedLongitudinalEvidenceInput extends PaperPortfolioTrustedEvidenceRiskFacts {
  readonly trustedRun: PaperChaosTrustedGitHubRunReceipt;
  readonly periodIds: readonly string[];
  readonly outcomeReceiptFingerprints: readonly string[];
}

export interface PaperPortfolioRiskEvidenceInput extends PaperPortfolioTrustedEvidenceRiskFacts {
  readonly evaluationId: string;
  readonly status: PaperPortfolioRiskEvidenceStatus;
  readonly minimumEvidencePeriods: number;
  readonly maximumEvidenceAgeMs: number;
  readonly maximumDrawdownContribution: number;
  readonly minimumDiversificationBenefit: number;
  readonly maximumAllowedCandidateCorrelation: number;
  /** Optional canonical run receipt used to bind the evidence to the evaluated workflow run. */
  readonly trustedRun?: PaperChaosTrustedGitHubRunReceipt;
  readonly trustedEvidence?: PaperPortfolioTrustedLongitudinalEvidence;
}

export interface PaperPortfolioRiskEvidenceResult {
  readonly evaluationId: string;
  readonly decision: PaperPortfolioRiskDecision;
  readonly reasons: readonly string[];
  readonly candidateId: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
  readonly observedAt: string;
  readonly evaluatedAt: string;
  readonly portfolioDrawdownContribution: number;
  readonly diversificationBenefit: number;
  readonly maximumAbsoluteCandidateCorrelation: number;
  readonly portfolioRegime: string;
  readonly regimeCoFailureRate: number;
  readonly currentPortfolioGrossWeight: number;
  readonly currentStrategyWeight: number;
  readonly estimatedTurnover: number;
  readonly estimatedFeeRate: number;
  readonly estimatedSlippageRate: number;
  readonly grossExpectedEdge: number;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

const sha256 = /^[a-f0-9]{64}$/i;
const sourceSha = /^[a-f0-9]{40}$/i;
const repository = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const workflowRef = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/\.github\/workflows\/[^@]+\.(?:yml|yaml)@refs\/heads\/.+$/;
const trustedEvidenceObjects = new WeakSet<object>();

const canonical = (value: unknown): string => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("portfolio evidence binding contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  throw new Error("portfolio evidence binding contains an unsupported value");
};

const digest = (value: unknown): string => createHash("sha256").update(canonical(value), "utf8").digest("hex");
const trustedPayload = (evidence: Omit<PaperPortfolioTrustedLongitudinalEvidence, "evidenceFingerprintSha256">): Omit<PaperPortfolioTrustedLongitudinalEvidence, "evidenceFingerprintSha256"> => evidence;

const bindingFacts = (
  facts: PaperPortfolioTrustedEvidenceRiskFacts,
  run: PaperChaosTrustedGitHubRunReceipt,
  periodIds: readonly string[],
  outcomeReceiptFingerprints: readonly string[],
): object => ({
  candidateId: facts.candidateId,
  datasetId: facts.datasetId,
  datasetContentSha256: facts.datasetContentSha256,
  observedAt: facts.observedAt,
  evaluatedAt: facts.evaluatedAt,
  evidencePeriods: facts.evidencePeriods,
  portfolioDrawdownContribution: facts.portfolioDrawdownContribution,
  diversificationBenefit: facts.diversificationBenefit,
  maximumAbsoluteCandidateCorrelation: facts.maximumAbsoluteCandidateCorrelation,
  portfolioRegime: facts.portfolioRegime,
  regimeCoFailureRate: facts.regimeCoFailureRate,
  currentPortfolioGrossWeight: facts.currentPortfolioGrossWeight,
  currentStrategyWeight: facts.currentStrategyWeight,
  estimatedTurnover: facts.estimatedTurnover,
  estimatedFeeRate: facts.estimatedFeeRate,
  estimatedSlippageRate: facts.estimatedSlippageRate,
  grossExpectedEdge: facts.grossExpectedEdge,
  trustedRun: run,
  periodIds,
  outcomeReceiptFingerprints,
});

const validateTrustedRun = (run: PaperChaosTrustedGitHubRunReceipt): void => {
  if (run.verificationSource !== "GITHUB_API" && run.verificationSource !== "RUNNER_ATTESTATION") throw new Error("trusted PAPER run source is invalid");
  if (!repository.test(run.repository)) throw new Error("trusted PAPER repository is invalid");
  if (!sourceSha.test(run.headSha)) throw new Error("trusted PAPER source SHA is invalid");
  if (!Number.isSafeInteger(run.workflowRunId) || run.workflowRunId <= 0) throw new Error("trusted PAPER workflow run id is invalid");
  if (!Number.isSafeInteger(run.workflowRunAttempt) || run.workflowRunAttempt <= 0) throw new Error("trusted PAPER workflow run attempt is invalid");
  if (!workflowRef.test(run.workflowRef) || !run.workflowRef.startsWith(`${run.repository}/`)) throw new Error("trusted PAPER workflow reference is invalid");
  if (!run.eventName.trim()) throw new Error("trusted PAPER event name is required");
  if (run.workflowRunUrl !== `https://github.com/${run.repository}/actions/runs/${run.workflowRunId}`) throw new Error("trusted PAPER workflow URL is invalid");
};

const requireFinite = (value: number, label: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
};
const requireRatio = (value: number, label: string): void => {
  requireFinite(value, label);
  if (value < 0 || value > 1) throw new Error(`${label} must be between 0 and 1`);
};

const validateTrustedFacts = (facts: PaperPortfolioTrustedEvidenceRiskFacts): void => {
  if (!facts.candidateId.trim() || !facts.datasetId.trim() || !sha256.test(facts.datasetContentSha256)) throw new Error("trusted PAPER evidence identity is invalid");
  if (!Number.isFinite(Date.parse(facts.observedAt)) || !Number.isFinite(Date.parse(facts.evaluatedAt))) throw new Error("trusted PAPER evidence timestamp is invalid");
  if (!Number.isSafeInteger(facts.evidencePeriods) || facts.evidencePeriods < 1) throw new Error("trusted PAPER evidence periods are invalid");
  if (!facts.portfolioRegime.trim()) throw new Error("portfolioRegime is required");
  requireRatio(facts.portfolioDrawdownContribution, "portfolioDrawdownContribution");
  requireFinite(facts.diversificationBenefit, "diversificationBenefit");
  requireRatio(facts.maximumAbsoluteCandidateCorrelation, "maximumAbsoluteCandidateCorrelation");
  requireRatio(facts.regimeCoFailureRate, "regimeCoFailureRate");
  requireRatio(facts.currentPortfolioGrossWeight, "currentPortfolioGrossWeight");
  requireRatio(facts.currentStrategyWeight, "currentStrategyWeight");
  requireRatio(facts.estimatedTurnover, "estimatedTurnover");
  requireRatio(facts.estimatedFeeRate, "estimatedFeeRate");
  requireRatio(facts.estimatedSlippageRate, "estimatedSlippageRate");
  requireFinite(facts.grossExpectedEdge, "grossExpectedEdge");
};

export function createPaperPortfolioTrustedLongitudinalEvidence(input: PaperPortfolioTrustedLongitudinalEvidenceInput): PaperPortfolioTrustedLongitudinalEvidence {
  validateTrustedRun(input.trustedRun);
  validateTrustedFacts(input);
  if (input.trustedRun.headSha.toLowerCase() !== input.trustedRun.headSha) throw new Error("trusted PAPER source SHA must be lowercase");
  if (input.periodIds.length !== input.evidencePeriods || input.outcomeReceiptFingerprints.length !== input.evidencePeriods) throw new Error("trusted PAPER outcome count does not match evidence periods");
  if (new Set(input.periodIds).size !== input.periodIds.length || input.periodIds.some((id) => !id.trim())) throw new Error("trusted PAPER period identities are invalid");
  if (input.outcomeReceiptFingerprints.some((fingerprint) => !sha256.test(fingerprint))) throw new Error("trusted PAPER outcome provenance is invalid");

  const evidence: Omit<PaperPortfolioTrustedLongitudinalEvidence, "evidenceFingerprintSha256"> = {
    schemaVersion: 1,
    verificationStatus: "VERIFIED",
    verificationSource: input.trustedRun.verificationSource,
    repository: input.trustedRun.repository,
    sourceSha: input.trustedRun.headSha,
    workflowRunId: input.trustedRun.workflowRunId,
    workflowRunAttempt: input.trustedRun.workflowRunAttempt,
    workflowRef: input.trustedRun.workflowRef,
    eventName: input.trustedRun.eventName,
    workflowRunUrl: input.trustedRun.workflowRunUrl,
    candidateId: input.candidateId,
    datasetId: input.datasetId,
    datasetContentSha256: input.datasetContentSha256,
    periodIds: Object.freeze([...input.periodIds]),
    outcomeReceiptFingerprints: Object.freeze([...input.outcomeReceiptFingerprints]),
    verifiedAt: input.evaluatedAt,
  };
  const result = Object.freeze({
    ...evidence,
    evidenceFingerprintSha256: digest({
      facts: bindingFacts(input, input.trustedRun, input.periodIds, input.outcomeReceiptFingerprints),
      evidence: trustedPayload(evidence),
    }),
  });
  trustedEvidenceObjects.add(result);
  return result;
}

const trustedEvidenceReasons = (input: PaperPortfolioRiskEvidenceInput): string[] => {
  const trusted = input.trustedEvidence;
  if (trusted == null) return ["CANONICAL_TRUSTED_PAPER_EVIDENCE_REQUIRED"];
  if (typeof trusted !== "object" || !trustedEvidenceObjects.has(trusted)) return ["UNTRUSTED_PAPER_EVIDENCE"];
  const reasons: string[] = [];
  try {
    const trustedRun: PaperChaosTrustedGitHubRunReceipt = {
      verificationSource: trusted.verificationSource,
      repository: trusted.repository,
      headSha: trusted.sourceSha,
      workflowRunId: trusted.workflowRunId,
      workflowRunAttempt: trusted.workflowRunAttempt,
      workflowRef: trusted.workflowRef,
      eventName: trusted.eventName,
      workflowRunUrl: trusted.workflowRunUrl,
    };
    validateTrustedRun(trustedRun);
    const run = input.trustedRun ?? trustedRun;
    validateTrustedRun(run);
    if (trusted.schemaVersion !== 1 || trusted.verificationStatus !== "VERIFIED") reasons.push("TRUSTED_PAPER_EVIDENCE_NOT_VERIFIED");
    if (trusted.sourceSha !== trusted.sourceSha.toLowerCase()) reasons.push("TRUSTED_PAPER_SOURCE_SHA_NOT_CANONICAL");
    if (trusted.candidateId !== input.candidateId || trusted.datasetId !== input.datasetId || trusted.datasetContentSha256 !== input.datasetContentSha256) reasons.push("TRUSTED_PAPER_PROVENANCE_MISMATCH");
    if (trusted.periodIds.length !== input.evidencePeriods || trusted.outcomeReceiptFingerprints.length !== input.evidencePeriods) reasons.push("TRUSTED_PAPER_OUTCOME_COUNT_MISMATCH");
    if (new Set(trusted.periodIds).size !== trusted.periodIds.length || trusted.periodIds.some((id) => typeof id !== "string" || !id.trim())) reasons.push("TRUSTED_PAPER_PERIOD_ID_INVALID");
    if (trusted.outcomeReceiptFingerprints.some((fingerprint) => !sha256.test(fingerprint))) reasons.push("TRUSTED_PAPER_OUTCOME_PROVENANCE_INVALID");
    const verifiedAtMs = Date.parse(trusted.verifiedAt);
    const evaluatedAtMs = Date.parse(input.evaluatedAt);
    if (!Number.isFinite(verifiedAtMs) || verifiedAtMs > evaluatedAtMs) reasons.push("TRUSTED_PAPER_EVIDENCE_TIME_INVALID");
    if (trustedRun.workflowRunId !== run.workflowRunId
      || trustedRun.workflowRunAttempt !== run.workflowRunAttempt
      || trustedRun.workflowRef !== run.workflowRef
      || trustedRun.eventName !== run.eventName
      || trustedRun.workflowRunUrl !== run.workflowRunUrl) {
      reasons.push("TRUSTED_PAPER_RUN_BINDING_MISMATCH");
    }
    const expectedFingerprint = digest({
      facts: bindingFacts(input, run, trusted.periodIds, trusted.outcomeReceiptFingerprints),
      evidence: {
        schemaVersion: trusted.schemaVersion,
        verificationStatus: trusted.verificationStatus,
        verificationSource: trusted.verificationSource,
        repository: trusted.repository,
        sourceSha: trusted.sourceSha,
        workflowRunId: trusted.workflowRunId,
        workflowRunAttempt: trusted.workflowRunAttempt,
        workflowRef: trusted.workflowRef,
        eventName: trusted.eventName,
        workflowRunUrl: trusted.workflowRunUrl,
        candidateId: trusted.candidateId,
        datasetId: trusted.datasetId,
        datasetContentSha256: trusted.datasetContentSha256,
        periodIds: trusted.periodIds,
        outcomeReceiptFingerprints: trusted.outcomeReceiptFingerprints,
        verifiedAt: trusted.verifiedAt,
      },
    });
    if (trusted.evidenceFingerprintSha256 !== expectedFingerprint) reasons.push("TRUSTED_PAPER_EVIDENCE_FINGERPRINT_MISMATCH");
  } catch {
    reasons.push("TRUSTED_PAPER_EVIDENCE_INVALID");
  }
  return reasons;
};

export function evaluatePaperPortfolioRiskEvidence(input: PaperPortfolioRiskEvidenceInput): PaperPortfolioRiskEvidenceResult {
  if (!input.evaluationId.trim()) throw new Error("evaluationId is required");
  if (!input.candidateId.trim()) throw new Error("candidateId is required");
  if (!input.datasetId.trim()) throw new Error("datasetId is required");
  if (!sha256.test(input.datasetContentSha256)) throw new Error("datasetContentSha256 must be sha256");
  const observedAtMs = Date.parse(input.observedAt);
  const evaluatedAtMs = Date.parse(input.evaluatedAt);
  if (!Number.isFinite(observedAtMs)) throw new Error("observedAt must be a valid ISO timestamp");
  if (!Number.isFinite(evaluatedAtMs)) throw new Error("evaluatedAt must be a valid ISO timestamp");
  if (!Number.isInteger(input.evidencePeriods) || input.evidencePeriods < 0) throw new Error("evidencePeriods must be a non-negative integer");
  if (!Number.isInteger(input.minimumEvidencePeriods) || input.minimumEvidencePeriods <= 0) throw new Error("minimumEvidencePeriods must be a positive integer");
  if (!Number.isFinite(input.maximumEvidenceAgeMs) || input.maximumEvidenceAgeMs < 0) throw new Error("maximumEvidenceAgeMs must be non-negative");
  validateTrustedFacts(input);
  requireRatio(input.maximumDrawdownContribution, "maximumDrawdownContribution");
  requireFinite(input.minimumDiversificationBenefit, "minimumDiversificationBenefit");
  requireRatio(input.maximumAllowedCandidateCorrelation, "maximumAllowedCandidateCorrelation");

  const reasons: string[] = trustedEvidenceReasons(input);
  if (input.status !== "VERIFIED") reasons.push(`EVIDENCE_${input.status}`);
  if (input.evidencePeriods < input.minimumEvidencePeriods) reasons.push("INSUFFICIENT_LONGITUDINAL_EVIDENCE");
  if (observedAtMs > evaluatedAtMs) reasons.push("FUTURE_EVIDENCE");
  if (evaluatedAtMs - observedAtMs > input.maximumEvidenceAgeMs) reasons.push("STALE_EVIDENCE");
  if (input.portfolioDrawdownContribution > input.maximumDrawdownContribution) reasons.push("DRAWDOWN_CONTRIBUTION_LIMIT_EXCEEDED");
  if (input.diversificationBenefit < input.minimumDiversificationBenefit) reasons.push("INSUFFICIENT_DIVERSIFICATION_BENEFIT");
  if (input.maximumAbsoluteCandidateCorrelation > input.maximumAllowedCandidateCorrelation) reasons.push("CANDIDATE_DEPENDENCE_LIMIT_EXCEEDED");

  return Object.freeze({
    evaluationId: input.evaluationId,
    decision: reasons.length === 0 ? "ACCEPT" : "ABSTAIN",
    reasons: Object.freeze([...reasons].sort()),
    candidateId: input.candidateId,
    datasetId: input.datasetId,
    datasetContentSha256: input.datasetContentSha256,
    observedAt: input.observedAt,
    evaluatedAt: input.evaluatedAt,
    portfolioDrawdownContribution: input.portfolioDrawdownContribution,
    diversificationBenefit: input.diversificationBenefit,
    maximumAbsoluteCandidateCorrelation: input.maximumAbsoluteCandidateCorrelation,
    portfolioRegime: input.portfolioRegime,
    regimeCoFailureRate: input.regimeCoFailureRate,
    currentPortfolioGrossWeight: input.currentPortfolioGrossWeight,
    currentStrategyWeight: input.currentStrategyWeight,
    estimatedTurnover: input.estimatedTurnover,
    estimatedFeeRate: input.estimatedFeeRate,
    estimatedSlippageRate: input.estimatedSlippageRate,
    grossExpectedEdge: input.grossExpectedEdge,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}
