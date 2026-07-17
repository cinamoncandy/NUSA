import { EvidenceCompletenessDecision, type EvidenceCompletenessAuditResult } from "./evidence-completeness-audit";
import { DeploymentEvidenceChainDecision, type DeploymentEvidenceChainResult } from "./deployment-evidence-chain";
import { ReleaseCandidatePromotionDecision, type ReleaseCandidatePromotionResult } from "./release-candidate-promotion";

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
