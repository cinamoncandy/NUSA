import { createHash } from "node:crypto";
import type { CommitteeVote, PaperPerformanceSummary, StrategyGovernanceDecision, StrategyIdentity, StrategyValidationSummary } from "../../../packages/contracts/src/strategyGovernance";
import type { PaperPerformanceFromLedgerResult } from "./paperPerformanceFromLedger";
import { evaluateStrategyPromotion } from "./strategyPromotionEngine";

const SHA256 = /^[a-f0-9]{64}$/;

export interface PaperPerformanceGovernanceFeedbackInput {
  readonly now: number;
  readonly identity: StrategyIdentity;
  readonly validation?: StrategyValidationSummary;
  readonly paper?: PaperPerformanceSummary;
  readonly votes: readonly CommitteeVote[];
  /** Canonical current dataset fingerprint supplied by the dataset owner. */
  readonly currentDataFingerprint: string;
  readonly ledgerPerformance: PaperPerformanceFromLedgerResult;
}

export interface PaperPerformanceGovernanceFeedbackReceipt {
  readonly schemaVersion: 1;
  readonly evidenceKind: "PAPER";
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly familyId: string;
  readonly candidateId: string;
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly metricVersion: string;
  readonly sourceLedgerFingerprintSha256: string;
  readonly performanceEvidenceFingerprintSha256: string;
  readonly canonicalOutcomeReceiptFingerprint: string;
  readonly decision: StrategyGovernanceDecision;
  readonly replayVerified: true;
  readonly stale: false;
  readonly receiptFingerprintSha256: string;
}

function fingerprint(value: Omit<PaperPerformanceGovernanceFeedbackReceipt, "receiptFingerprintSha256">): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function evaluatePaperPerformanceGovernanceFeedback(
  input: PaperPerformanceGovernanceFeedbackInput,
): PaperPerformanceGovernanceFeedbackReceipt {
  const { evidence, familyId, ledgerSource, canonicalOutcomeReceiptFingerprint } = input.ledgerPerformance;
  if (!Number.isSafeInteger(input.now) || input.now < evidence.generatedAt) throw new Error("PAPER_GOVERNANCE_FEEDBACK_STALE_OR_FUTURE");
  if (evidence.evidenceKind !== "PAPER" || evidence.authority !== "PAPER_ONLY" || evidence.liveAuthority !== "NONE" || evidence.productionMutationAllowed !== false || evidence.aiAuthority !== "ZERO_AUTHORITY") {
    throw new Error("PAPER_GOVERNANCE_FEEDBACK_AUTHORITY_INVALID");
  }
  if (input.identity.strategyId !== evidence.strategyId || input.identity.version !== evidence.strategyVersion || input.identity.familyId !== familyId) {
    throw new Error("PAPER_GOVERNANCE_FEEDBACK_IDENTITY_MISMATCH");
  }
  if (!SHA256.test(evidence.evidenceFingerprintSha256) || !SHA256.test(evidence.sourceLedgerFingerprintSha256) || ledgerSource.ledgerFingerprintSha256 !== evidence.sourceLedgerFingerprintSha256) {
    throw new Error("PAPER_GOVERNANCE_FEEDBACK_LEDGER_IDENTITY_MISMATCH");
  }
  if (!SHA256.test(canonicalOutcomeReceiptFingerprint)) throw new Error("PAPER_GOVERNANCE_FEEDBACK_OUTCOME_IDENTITY_INVALID");
  if (input.paper?.endedAt != null && (input.paper.startedAt > evidence.periodStartAt || input.paper.endedAt !== evidence.periodEndAt)) {
    throw new Error("PAPER_GOVERNANCE_FEEDBACK_OBSERVATION_RANGE_MISMATCH");
  }

  const decision = evaluateStrategyPromotion({
    now: input.now,
    identity: input.identity,
    validation: input.validation,
    paper: input.paper,
    votes: input.votes,
    currentDataFingerprint: input.currentDataFingerprint,
  });

  const body = Object.freeze({
    schemaVersion: 1 as const,
    evidenceKind: "PAPER" as const,
    strategyId: evidence.strategyId,
    strategyVersion: evidence.strategyVersion,
    familyId,
    candidateId: evidence.candidateId,
    periodStartAt: evidence.periodStartAt,
    periodEndAt: evidence.periodEndAt,
    metricVersion: evidence.calculationVersion,
    sourceLedgerFingerprintSha256: evidence.sourceLedgerFingerprintSha256,
    performanceEvidenceFingerprintSha256: evidence.evidenceFingerprintSha256,
    canonicalOutcomeReceiptFingerprint,
    decision,
    replayVerified: true as const,
    stale: false as const,
  });
  return Object.freeze({ ...body, receiptFingerprintSha256: fingerprint(body) });
}
