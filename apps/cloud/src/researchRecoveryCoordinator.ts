import { createHash } from "node:crypto";
import type { CandidateLifecycleRecord, PromotionAuditRecord, ResearchCandidateIdentity } from "../../../packages/contracts/src/candidatePromotion";
import type { ResearchComparisonEvidence, ResearchEvaluationLedger } from "../../../packages/contracts/src/researchRuntime";
import type { ResearchRecoveryResult, ResearchRuntimeSnapshot } from "../../../packages/contracts/src/researchRecovery";
import { canonicalResearchJson } from "../../../packages/contracts/src/researchRuntime";
import type { PromotionCommandState, SqliteCandidatePromotionRepository } from "../../../packages/storage/src/candidatePromotionRepository";

export interface ResearchRecoveryRepository {
  listCandidates(): readonly CandidateLifecycleRecord[];
  getChampion(): string | null;
  listCommands(): readonly PromotionCommandState[];
  listAudit(): readonly PromotionAuditRecord[];
  verifyAudit(): void;
}

export interface ResearchRecoveryCoordinatorOptions {
  readonly evaluationLedger: ResearchEvaluationLedger;
  readonly repository: ResearchRecoveryRepository;
  readonly now?: () => number;
}

const genesis = "0".repeat(64);
const digest = (value: unknown): string => createHash("sha256").update(canonicalResearchJson(value), "utf8").digest("hex");
const evidenceDigest = (value: ResearchComparisonEvidence): string => digest(value);
const asSorted = <T>(values: readonly T[], key: (value: T) => string): readonly T[] => [...values].sort((a, b) => key(a).localeCompare(key(b)));

function invariant(condition: unknown, reason: string): asserts condition { if (!condition) throw new Error(reason); }
function validateCandidateIdentity(identity: ResearchCandidateIdentity): void {
  invariant(identity.authority === "PAPER_ONLY" && identity.paperOnly === true, "CANDIDATE_AUTHORITY_INVALID");
  invariant(identity.candidateId.trim() && identity.strategyId.trim() && identity.strategyVersion.trim(), "CANDIDATE_IDENTITY_INVALID");
  invariant(identity.originatingEvaluationId.trim() && /^[a-f0-9]{64}$/.test(identity.originatingInputHash), "CANDIDATE_REFERENCE_INVALID");
  invariant(/^[a-f0-9]{64}$/.test(identity.artifactHash) && /^[a-f0-9]{64}$/.test(identity.configHash), "CANDIDATE_CONFIG_HASH_INVALID");
}

export class ResearchRecoveryCoordinator {
  private readonly now: () => number;
  public constructor(private readonly options: ResearchRecoveryCoordinatorOptions) { this.now = options.now ?? (() => Date.now()); }

  public recover(): ResearchRecoveryResult {
    try {
      const evaluations = [...this.options.evaluationLedger.list()];
      invariant(evaluations.every((item) => item.schemaVersion === 1 && item.productionMutationAllowed === false && item.promotionAllowed === false), "EVALUATION_AUTHORITY_INVALID");
      const evaluationById = new Map(evaluations.map((item) => [item.evaluationId, item]));
      const candidates = asSorted(this.options.repository.listCandidates(), (item) => item.identity.candidateId);
      const candidateById = new Map<string, CandidateLifecycleRecord>();
      for (const candidate of candidates) {
        validateCandidateIdentity(candidate.identity);
        invariant(!candidateById.has(candidate.identity.candidateId), "DUPLICATE_CANDIDATE_ID");
        invariant(["DRAFT", "RESEARCHING", "VALIDATED", "PAPER_CANDIDATE", "PAPER_ACTIVE", "PROMOTION_PENDING", "CHAMPION", "CHALLENGER", "SUSPENDED", "ROLLED_BACK", "RETIRED", "REJECTED"].includes(candidate.lifecycle), "UNKNOWN_CANDIDATE_LIFECYCLE");
        candidateById.set(candidate.identity.candidateId, candidate);
      }
      this.options.repository.verifyAudit();
      const audit = [...this.options.repository.listAudit()];
      const commands = asSorted(this.options.repository.listCommands(), (item) => item.commandId);
      const commandById = new Map(commands.map((item) => [item.commandId, item]));
      for (const candidate of candidates) {
        const evidence = evaluationById.get(candidate.identity.originatingEvaluationId);
        invariant(evidence != null, "MISSING_ORIGINATING_EVALUATION");
        invariant(evidence.canonicalInputHash === candidate.identity.originatingInputHash, "CANDIDATE_INPUT_HASH_MISMATCH");
        invariant(evidence.challenger?.strategyId === candidate.identity.strategyId && evidence.challenger.strategyVersion === candidate.identity.strategyVersion, "CANDIDATE_STRATEGY_VERSION_MISMATCH");
        invariant(evidence.fillModelVersion.trim() && evidence.feeModelVersion.trim() && evidence.slippageModelVersion.trim(), "EVALUATION_MODEL_IDENTITY_MISSING");
      }
      const promotedAudit = audit.filter((item) => item.result === "PROMOTED");
      const promotedCandidates = new Set<string>();
      const challengerCandidates = new Set<string>();
      for (const item of audit) {
        const command = commandById.get(item.promotionCommandId);
        invariant(command != null, "AUDIT_COMMAND_REFERENCE_MISSING");
        invariant(command.result.status === item.result && command.result.promotionCommandId === item.promotionCommandId, "AUDIT_COMMAND_RESULT_MISMATCH");
        if (item.candidate != null) {
          const candidate = candidateById.get(item.candidate.candidateId);
          invariant(candidate != null && digest(candidate.identity) === digest(item.candidate), "AUDIT_CANDIDATE_REFERENCE_MISMATCH");
        }
        const evidence = evaluationById.get(item.evidenceEvaluationId);
        if (item.result === "PROMOTED") {
          invariant(evidence != null && evidenceDigest(evidence) === item.evidenceHash, "PROMOTION_EVIDENCE_MISMATCH");
          invariant(item.candidate != null && item.resultingChampionCandidateId === item.candidate.candidateId, "PROMOTION_CANDIDATE_MISSING");
          invariant(item.actorRef.trim() && item.previousChampionCandidateId !== item.resultingChampionCandidateId, "PROMOTION_ACTOR_OR_POINTER_INVALID");
          promotedCandidates.add(item.resultingChampionCandidateId!);
          if (item.previousChampionCandidateId != null) challengerCandidates.add(item.previousChampionCandidateId);
        }
      }
      const championId = this.options.repository.getChampion();
      const championCandidates = candidates.filter((item) => item.lifecycle === "CHAMPION");
      invariant(championCandidates.length <= 1, "MULTIPLE_CHAMPIONS");
      invariant(championId == null ? championCandidates.length === 0 : championCandidates.length === 1 && championCandidates[0]!.identity.candidateId === championId, "CHAMPION_POINTER_LIFECYCLE_MISMATCH");
      if (championId != null) {
        invariant(promotedCandidates.has(championId), "CHAMPION_PROMOTION_HISTORY_MISSING");
        invariant(promotedAudit.at(-1)?.resultingChampionCandidateId === championId, "CHAMPION_POINTER_AUDIT_MISMATCH");
      }
      for (const candidate of candidates) {
        if (candidate.lifecycle === "CHAMPION") invariant(promotedCandidates.has(candidate.identity.candidateId), "CHAMPION_WITHOUT_PROMOTION");
        if (candidate.lifecycle === "CHALLENGER") invariant(challengerCandidates.has(candidate.identity.candidateId), "CHALLENGER_WITHOUT_PROMOTION");
      }
      const core = {
        schemaVersion: 1 as const,
        currentChampionCandidateId: championId,
        candidates,
        evaluations,
        audit,
        commands,
        championAuthority: "PAPER_ONLY" as const,
        challengerAuthority: "ZERO_AUTHORITY" as const,
        liveAuthority: "NONE" as const,
        productionMutationAllowed: false as const
      };
      const snapshot: ResearchRuntimeSnapshot = Object.freeze({
        schemaVersion: 1,
        currentChampionCandidateId: championId,
        candidates: Object.freeze(candidates),
        evaluationLedgerCount: evaluations.length,
        evaluationLedgerHead: typeof this.options.evaluationLedger.headHash === "function" ? this.options.evaluationLedger.headHash() : digest(evaluations.at(-1) ?? null),
        promotionAuditCount: audit.length,
        promotionAuditHead: audit.at(-1)?.currentAuditHash ?? genesis,
        promotionCommandCount: commands.length,
        promotionCommands: Object.freeze(commands.map((item) => Object.freeze({ commandId: item.commandId, payloadFingerprint: item.payloadFingerprint, result: item.result }))),
        stateDigest: digest(core),
        recoveredAt: this.now(),
        championAuthority: "PAPER_ONLY",
        challengerAuthority: "ZERO_AUTHORITY",
        liveAuthority: "NONE",
        productionMutationAllowed: false
      });
      return Object.freeze({ status: "READY", snapshot, reasons: Object.freeze([]) });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "RESEARCH_RECOVERY_FAILED";
      return Object.freeze({ status: "FAIL_CLOSED", snapshot: null, reasons: Object.freeze([reason]) });
    }
  }
}

export type { SqliteCandidatePromotionRepository };
