import { EvidenceCompletenessDecision, type EvidenceCompletenessAuditResult } from "./evidence-completeness-audit";
import { DeploymentEvidenceChainDecision, type DeploymentEvidenceChainResult, type DeploymentEvidenceChainVerifier } from "./deployment-evidence-chain";
import { ReleaseCandidatePromotionDecision, type ReleaseCandidatePromotionResult } from "./release-candidate-promotion";
import type { SqliteEvidenceCompletenessAuditRepository } from "./evidence-completeness-audit-evidence";
import type { SqlitePromotionEvidenceRepository } from "./promotion-evidence";

export enum FinalSyntheticReleaseEnvelopeDecision { SEALED_SYNTHETIC_ONLY="SEALED_SYNTHETIC_ONLY", BLOCKED="BLOCKED" }
export interface FinalSyntheticReleaseEnvelope { readonly envelopeId:string;readonly candidateId:string;readonly decision:FinalSyntheticReleaseEnvelopeDecision;readonly productionMutationAllowed:false;readonly deploymentAllowed:false;readonly limitations:readonly string[];readonly blockers:readonly string[];readonly sealedAtMs:number; }
export function createFinalSyntheticReleaseEnvelope(input:{readonly envelopeId:string;readonly candidateId:string;readonly promotion:ReleaseCandidatePromotionResult;readonly audit:EvidenceCompletenessAuditResult;readonly deploymentChain:DeploymentEvidenceChainResult;readonly nowMs:number;}):FinalSyntheticReleaseEnvelope{
 if(!input.envelopeId.trim()||!input.candidateId.trim()||!Number.isSafeInteger(input.nowMs)||input.nowMs<0)throw new Error("valid final release envelope identity and time are required");
 const blockers:string[]=[];
 if(input.promotion.candidateId!==input.candidateId)blockers.push("PROMOTION_CANDIDATE_MISMATCH");
 if(input.audit.candidateId!==input.candidateId)blockers.push("AUDIT_CANDIDATE_MISMATCH");
 if(input.deploymentChain.candidateId!==input.candidateId)blockers.push("DEPLOYMENT_CHAIN_CANDIDATE_MISMATCH");
 if(input.promotion.decision!==ReleaseCandidatePromotionDecision.PROMOTABLE)blockers.push("CANDIDATE_NOT_PROMOTABLE");
 if(input.audit.decision!==EvidenceCompletenessDecision.COMPLETE)blockers.push("EVIDENCE_AUDIT_INCOMPLETE");
 if(input.deploymentChain.decision!==DeploymentEvidenceChainDecision.COMPLETE_BLOCKED)blockers.push("DEPLOYMENT_DENIAL_CHAIN_INVALID");
 const limitations=["SYNTHETIC_EVIDENCE_ONLY","NO_PRODUCTION_DEPLOYMENT_AUTHORITY","NO_PRODUCTION_MUTATION_AUTHORITY","NO_REAL_CAPITAL_OR_ORDER_AUTHORITY"];
 return Object.freeze({envelopeId:input.envelopeId,candidateId:input.candidateId,decision:blockers.length?FinalSyntheticReleaseEnvelopeDecision.BLOCKED:FinalSyntheticReleaseEnvelopeDecision.SEALED_SYNTHETIC_ONLY,productionMutationAllowed:false,deploymentAllowed:false,limitations:Object.freeze(limitations),blockers:Object.freeze(blockers.sort()),sealedAtMs:input.nowMs});
}

/**
 * Repository-backed sealing of the final synthetic release envelope.
 *
 * This is the last certification gate in the system, so it accepts only identifiers: the
 * promotion record, the completeness audit, and every link of the deployment denial chain are
 * loaded from their append-only stores. Evidence that was never durably recorded produces a
 * blocker rather than an exception, so an unrecorded input can only ever make the envelope more
 * blocked, never silently absent. Sealing still confers no deployment or production authority.
 */
export class FinalSyntheticReleaseEnvelopeSealer {
 public constructor(
  private readonly promotions:SqlitePromotionEvidenceRepository,
  private readonly audits:SqliteEvidenceCompletenessAuditRepository,
  private readonly chainVerifier:DeploymentEvidenceChainVerifier
 ){}

 public seal(input:{readonly envelopeId:string;readonly candidateId:string;readonly promotionId:string;readonly auditId:string;readonly attemptId:string;readonly credentialBoundaryEvaluationId:string;readonly adapterAttestationId:string;readonly nowMs:number;}):FinalSyntheticReleaseEnvelope{
  if(!input.envelopeId.trim()||!input.candidateId.trim()||!Number.isSafeInteger(input.nowMs)||input.nowMs<0)throw new Error("valid final release envelope identity and time are required");
  const promotion=this.promotions.get(input.promotionId);
  const audit=this.audits.get(input.auditId);
  const missing:string[]=[];
  if(!promotion)missing.push("PROMOTION_EVIDENCE_NOT_RECORDED");
  if(!audit)missing.push("EVIDENCE_AUDIT_NOT_RECORDED");
  const deploymentChain=this.chainVerifier.verify({attemptId:input.attemptId,credentialBoundaryEvaluationId:input.credentialBoundaryEvaluationId,adapterAttestationId:input.adapterAttestationId,expectedCandidateId:input.candidateId,nowMs:input.nowMs});
  if(missing.length){
   const limitations=["SYNTHETIC_EVIDENCE_ONLY","NO_PRODUCTION_DEPLOYMENT_AUTHORITY","NO_PRODUCTION_MUTATION_AUTHORITY","NO_REAL_CAPITAL_OR_ORDER_AUTHORITY"];
   const blockers=[...missing];
   if(deploymentChain.decision!==DeploymentEvidenceChainDecision.COMPLETE_BLOCKED)blockers.push("DEPLOYMENT_DENIAL_CHAIN_INVALID");
   return Object.freeze({envelopeId:input.envelopeId,candidateId:input.candidateId,decision:FinalSyntheticReleaseEnvelopeDecision.BLOCKED,productionMutationAllowed:false,deploymentAllowed:false,limitations:Object.freeze(limitations),blockers:Object.freeze(blockers.sort()),sealedAtMs:input.nowMs});
  }
  return createFinalSyntheticReleaseEnvelope({envelopeId:input.envelopeId,candidateId:input.candidateId,promotion:promotion as unknown as ReleaseCandidatePromotionResult,audit:audit!,deploymentChain,nowMs:input.nowMs});
 }
}
