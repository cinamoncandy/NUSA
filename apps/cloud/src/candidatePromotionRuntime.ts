import { createHash } from "node:crypto";
import type { ResearchComparisonEvidence, ResearchEvaluationLedger } from "../../../packages/contracts/src/researchRuntime";
import type { CandidateLifecycleRecord, PromotionAuditRecord, PromotionCommand, PromotionResult, ResearchCandidateIdentity } from "../../../packages/contracts/src/candidatePromotion";
import type { StrategyLifecycle } from "../../../packages/contracts/src/strategyGovernance";
import { canonicalResearchJson } from "../../../packages/contracts/src/researchRuntime";
import { validateResearchCostEvidence } from "./researchCostEvidence";
import type { SqliteCandidatePromotionRepository } from "../../../packages/storage/src/candidatePromotionRepository";

export interface CandidatePromotionRepository {
  saveCandidate(record: CandidateLifecycleRecord): void;
  getCandidate(candidateId: string): CandidateLifecycleRecord | null;
  listCandidates(): readonly CandidateLifecycleRecord[];
  getChampion(): string | null;
  getCommand(commandId: string): { fingerprint: string; result: PromotionResult } | null;
  recordRejected(command: PromotionCommand, result: PromotionResult, audit: PromotionAuditRecord): void;
  promoteAtomic(input: { command: PromotionCommand; candidate: CandidateLifecycleRecord; previousCandidate: CandidateLifecycleRecord | null; result: PromotionResult; audit: PromotionAuditRecord }): void;
  appendRejectedAudit(audit: PromotionAuditRecord): void;
  listAudit(): readonly PromotionAuditRecord[];
  verifyAudit(): void;
}

export interface OwnerAuthorizationContext {
  readonly actorRef: string;
  readonly authenticated: true;
}

export interface OwnerAuthorizationPort {
  authorize(command: PromotionCommand): OwnerAuthorizationContext | null;
}

export interface CandidatePromotionRuntimeOptions {
  readonly repository: CandidatePromotionRepository;
  readonly evaluationLedger: ResearchEvaluationLedger;
  readonly ownerAuthorization?: OwnerAuthorizationPort;
  /** @deprecated A string allow-list is not an authentication boundary and cannot authorize promotion. */
  readonly ownerActorRefs?: readonly string[];
  readonly now?: () => number;
  readonly maxEvidenceAgeMs?: number;
}

const genesis = "0".repeat(64);
const hash = (value: unknown): string => createHash("sha256").update(canonicalResearchJson(value), "utf8").digest("hex");
const freeze = <T>(value: T): T => Object.freeze(value);
const lifecycleTransitions: ReadonlyMap<StrategyLifecycle, ReadonlySet<StrategyLifecycle>> = new Map([
  ["DRAFT", new Set(["RESEARCHING", "REJECTED"])],
  ["RESEARCHING", new Set(["VALIDATED", "REJECTED"])],
  ["VALIDATED", new Set(["PAPER_CANDIDATE", "REJECTED"])],
  ["PAPER_CANDIDATE", new Set(["PROMOTION_PENDING", "PAPER_ACTIVE", "REJECTED"])],
  ["PAPER_ACTIVE", new Set(["PROMOTION_PENDING", "SUSPENDED", "RETIRED"])],
  ["PROMOTION_PENDING", new Set(["CHAMPION", "REJECTED"])],
  ["CHAMPION", new Set(["CHALLENGER", "SUSPENDED", "ROLLED_BACK", "RETIRED"])],
  ["CHALLENGER", new Set(["SUSPENDED", "ROLLED_BACK", "RETIRED"])],
  ["SUSPENDED", new Set(["PAPER_ACTIVE", "REJECTED", "RETIRED"])],
  ["ROLLED_BACK", new Set(["RESEARCHING", "RETIRED"])],
  ["RETIRED", new Set()],
  ["REJECTED", new Set()]
]);

function validateCandidateIdentity(identity: ResearchCandidateIdentity): void {
  if (!identity.candidateId.trim() || !identity.strategyId.trim() || !identity.strategyVersion.trim() || !identity.originatingEvaluationId.trim()) throw new Error("candidate identity is incomplete");
  for (const value of [identity.artifactHash, identity.configHash, identity.originatingInputHash]) if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("candidate hash is invalid");
  if (!Number.isSafeInteger(identity.createdAt) || identity.createdAt < 0 || identity.authority !== "PAPER_ONLY" || identity.paperOnly !== true) throw new Error("candidate must be PAPER_ONLY");
}

function commandFingerprint(command: PromotionCommand): string { return hash(command); }

export class CandidatePromotionRuntime {
  private readonly now: () => number;
  private readonly maxEvidenceAgeMs: number;
  public constructor(private readonly options: CandidatePromotionRuntimeOptions) {
    this.now = options.now ?? (() => Date.now());
    this.maxEvidenceAgeMs = options.maxEvidenceAgeMs ?? 86_400_000;
  }

  public registerCandidate(identity: ResearchCandidateIdentity, lifecycle: StrategyLifecycle = "PAPER_CANDIDATE"): CandidateLifecycleRecord {
    validateCandidateIdentity(identity);
    if (!["DRAFT", "RESEARCHING", "VALIDATED", "PAPER_CANDIDATE"].includes(lifecycle)) throw new Error("candidate registration lifecycle is not eligible");
    const record = freeze({ identity: freeze({ ...identity }), lifecycle });
    const existing = this.options.repository.getCandidate(identity.candidateId);
    if (existing != null) {
      if (hash(existing.identity) !== hash(identity)) throw new Error("candidate identity conflict");
      return existing;
    }
    this.options.repository.saveCandidate(record);
    return this.options.repository.getCandidate(identity.candidateId)!;
  }

  public transitionCandidate(candidateId: string, lifecycle: StrategyLifecycle): CandidateLifecycleRecord {
    const current = this.requireCandidate(candidateId);
    if (lifecycle === "CHAMPION" || lifecycle === "CHALLENGER") throw new Error("champion lifecycle requires owner promotion boundary");
    if (!lifecycleTransitions.get(current.lifecycle)?.has(lifecycle)) throw new Error("illegal candidate lifecycle transition");
    const next = freeze({ identity: current.identity, lifecycle });
    this.options.repository.saveCandidate(next);
    return this.options.repository.getCandidate(candidateId)!;
  }

  public evaluatePromotionEligibility(candidateId: string, evaluationId: string): { eligible: boolean; reason: string; evidence?: ResearchComparisonEvidence } {
    const candidate = this.requireCandidate(candidateId);
    try {
      const records = this.options.evaluationLedger.list();
      const evidence = records.find((item) => item.evaluationId === evaluationId);
      if (evidence == null) return { eligible: false, reason: "MISSING_EVIDENCE" };
      if (evidence.result !== "CHALLENGER_BETTER") return { eligible: false, reason: evidence.result === "INCONCLUSIVE" ? "INCONCLUSIVE_EVIDENCE" : "RESULT_NOT_SUPERIOR" };
      if (evidence.challenger == null || evidence.challenger.strategyId !== candidate.identity.strategyId || evidence.challenger.strategyVersion !== candidate.identity.strategyVersion) return { eligible: false, reason: "CANDIDATE_IDENTITY_MISMATCH" };
      if (evidence.evaluationId !== candidate.identity.originatingEvaluationId) return { eligible: false, reason: "ORIGINATING_EVALUATION_MISMATCH" };
      if (evidence.canonicalInputHash !== candidate.identity.originatingInputHash) return { eligible: false, reason: "INPUT_HASH_MISMATCH" };
      if (evidence.costEvidence == null) return { eligible: false, reason: "COST_EVIDENCE_MISSING" };
      const costDecision = validateResearchCostEvidence(evidence.costEvidence, evidence.evaluationTimestamp);
      if (costDecision.status !== "VERIFIED") return { eligible: false, reason: `COST_EVIDENCE_${costDecision.reasons[0] ?? "INVALID"}` };
      if (evidence.costEvidence.evaluationId !== evidence.evaluationId) return { eligible: false, reason: "COST_EVIDENCE_EVALUATION_MISMATCH" };
      if (evidence.provenance != null && (
        evidence.costEvidence.datasetId !== evidence.provenance.datasetId
        || evidence.costEvidence.datasetContentSha256 !== evidence.provenance.datasetContentSha256
      )) return { eligible: false, reason: "COST_EVIDENCE_PROVENANCE_MISMATCH" };
      if (typeof evidence.challenger.metrics.costAdjustedReturn !== "number" || !Number.isFinite(evidence.challenger.metrics.costAdjustedReturn)) return { eligible: false, reason: "COST_ADJUSTED_RETURN_MISSING" };
      if (Math.abs(evidence.costEvidence.netReturn - evidence.challenger.metrics.costAdjustedReturn) > 1e-12) return { eligible: false, reason: "COST_EVIDENCE_RETURN_MISMATCH" };
      if (!evidence.fillModelVersion || !evidence.feeModelVersion || !evidence.slippageModelVersion) return { eligible: false, reason: "COST_MODEL_MISSING" };
      if (evidence.productionMutationAllowed !== false || evidence.promotionAllowed !== false) return { eligible: false, reason: "AUTHORITY_INVARIANT_FAILED" };
      if (this.now() - evidence.evaluationTimestamp > this.maxEvidenceAgeMs || evidence.evaluationTimestamp > this.now()) return { eligible: false, reason: "STALE_EVIDENCE" };
      if (!["PAPER_CANDIDATE", "PROMOTION_PENDING"].includes(candidate.lifecycle)) return { eligible: false, reason: "CANDIDATE_STATE_INVALID" };
      return { eligible: true, reason: "ELIGIBLE_WITH_OWNER_COMMAND", evidence };
    } catch {
      return { eligible: false, reason: "EVIDENCE_VALIDATION_FAILED" };
    }
  }

  public promote(command: PromotionCommand): PromotionResult {
    const duplicate = this.options.repository.getCommand(command.promotionCommandId);
    if (duplicate != null) {
      if (duplicate.fingerprint !== commandFingerprint(command)) return freeze({ status: "CONFLICT", promotionCommandId: command.promotionCommandId, reason: "PROMOTION_COMMAND_ID_CONFLICT", previousChampionCandidateId: this.options.repository.getChampion(), resultingChampionCandidateId: this.options.repository.getChampion(), productionMutationAllowed: false as const, liveAuthority: "NONE" as const });
      return freeze({ ...duplicate.result, status: "DUPLICATE" });
    }
    const candidate = this.options.repository.getCandidate(command.candidateId);
    const currentChampion = this.options.repository.getChampion();
    if (candidate == null) return this.rejected(command, "UNKNOWN_CANDIDATE", "REJECTED");
    const authorization = this.options.ownerAuthorization?.authorize(command) ?? null;
    if (authorization == null || authorization.authenticated !== true) return this.rejected(command, "OWNER_AUTHORIZATION_REQUIRED", "REJECTED", candidate, "UNAUTHENTICATED");
    if (!authorization.actorRef.trim() || authorization.actorRef !== command.ownerActorRef) return this.rejected(command, "OWNER_IDENTITY_MISMATCH", "REJECTED", candidate, authorization.actorRef || "UNAUTHENTICATED");
    if (!command.reason.trim() || !Number.isSafeInteger(command.requestedAt)) return this.rejected(command, "INVALID_OWNER_COMMAND", "REJECTED", candidate, authorization.actorRef);
    if (currentChampion !== command.expectedCurrentChampionCandidateId) return this.rejected(command, "CHAMPION_COMPARE_AND_SET_CONFLICT", "CONFLICT", candidate, authorization.actorRef);
    const eligibility = this.evaluatePromotionEligibility(command.candidateId, command.evidenceEvaluationId);
    if (!eligibility.eligible || eligibility.evidence == null || hash(eligibility.evidence) !== command.evidenceHash) return this.rejected(command, eligibility.reason === "ELIGIBLE_WITH_OWNER_COMMAND" ? "EVIDENCE_HASH_MISMATCH" : eligibility.reason, "REJECTED", candidate, authorization.actorRef);
    const previous = currentChampion == null ? null : this.options.repository.getCandidate(currentChampion);
    if (previous != null && previous.lifecycle !== "CHAMPION") return this.rejected(command, "CHAMPION_STATE_INVALID", "REJECTED", candidate, authorization.actorRef);
    const promoted = freeze({ identity: candidate.identity, lifecycle: "CHAMPION" as const });
    const result = freeze({ status: "PROMOTED" as const, promotionCommandId: command.promotionCommandId, reason: "OWNER_PROMOTION_COMMITTED", previousChampionCandidateId: currentChampion, resultingChampionCandidateId: candidate.identity.candidateId, productionMutationAllowed: false as const, liveAuthority: "NONE" as const });
    const audit = this.audit(command, candidate.identity, currentChampion, candidate.identity.candidateId, result.status, null, authorization.actorRef);
    try {
      this.options.repository.promoteAtomic({ command, candidate: promoted, previousCandidate: previous == null ? null : freeze({ identity: previous.identity, lifecycle: "CHALLENGER" as const }), result, audit });
      return result;
    } catch (error) {
      if (error instanceof Error && error.message.includes("compare-and-set")) return this.rejected(command, "CHAMPION_COMPARE_AND_SET_CONFLICT", "CONFLICT", candidate, authorization.actorRef);
      throw error;
    }
  }

  public currentChampion(): CandidateLifecycleRecord | null { const id = this.options.repository.getChampion(); return id == null ? null : this.options.repository.getCandidate(id); }
  public listAudit(): readonly PromotionAuditRecord[] { return this.options.repository.listAudit(); }
  public verifyAudit(): void { this.options.repository.verifyAudit(); }

  private requireCandidate(candidateId: string): CandidateLifecycleRecord { const candidate = this.options.repository.getCandidate(candidateId); if (candidate == null) throw new Error("candidate not found"); return candidate; }
  private audit(command: PromotionCommand, candidate: ResearchCandidateIdentity | null, previous: string | null, resulting: string | null, result: PromotionAuditRecord["result"], rejectionReason: string | null, actorRef: string): PromotionAuditRecord {
    const prior = this.options.repository.listAudit().at(-1);
    return freeze({ promotionCommandId: command.promotionCommandId, candidate, previousChampionCandidateId: previous, resultingChampionCandidateId: resulting, evidenceEvaluationId: command.evidenceEvaluationId, evidenceHash: command.evidenceHash, actorRef, requestedAt: command.requestedAt, committedAt: this.now(), result, rejectionReason, previousAuditHash: prior?.currentAuditHash ?? genesis, currentAuditHash: "" });
  }
  private rejected(command: PromotionCommand, reason: string, status: "REJECTED" | "CONFLICT", candidate?: CandidateLifecycleRecord, actorRef = "UNAUTHENTICATED"): PromotionResult {
    const current = this.options.repository.getChampion();
    const result = freeze({ status, promotionCommandId: command.promotionCommandId, reason, previousChampionCandidateId: current, resultingChampionCandidateId: current, productionMutationAllowed: false as const, liveAuthority: "NONE" as const });
    this.options.repository.recordRejected(command, result, this.audit(command, candidate?.identity ?? null, current, current, status, reason, actorRef));
    return result;
  }
}

export type { SqliteCandidatePromotionRepository };
