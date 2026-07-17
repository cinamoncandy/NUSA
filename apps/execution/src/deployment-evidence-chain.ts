import { CredentialBoundaryDecision, type CredentialBoundaryResult } from "./credential-boundary";
import { ProductionAdapterAttestationDecision, type ProductionAdapterAttestation } from "./production-adapter-attestation";
import type { DeploymentAttemptEvidence } from "./deployment-attempt-evidence";

export enum DeploymentEvidenceChainDecision { COMPLETE_BLOCKED="COMPLETE_BLOCKED", INVALID="INVALID" }
export interface DeploymentEvidenceChainResult { readonly attemptId:string;readonly candidateId:string;readonly decision:DeploymentEvidenceChainDecision;readonly productionMutationAllowed:false;readonly deploymentAllowed:false;readonly blockers:readonly string[];readonly evaluatedAtMs:number; }
export function evaluateDeploymentEvidenceChain(input:{readonly attempt:DeploymentAttemptEvidence;readonly credentialBoundary:CredentialBoundaryResult;readonly adapterAttestation:ProductionAdapterAttestation;readonly expectedCandidateId:string;readonly nowMs:number;}):DeploymentEvidenceChainResult{
 if(!input.expectedCandidateId.trim()||!Number.isSafeInteger(input.nowMs)||input.nowMs<0)throw new Error("valid deployment evidence chain identity and time are required");
 const blockers:string[]=[];
 if(input.attempt.candidateId!==input.expectedCandidateId)blockers.push("DEPLOYMENT_ATTEMPT_CANDIDATE_MISMATCH");
 if(input.credentialBoundary.decision!==CredentialBoundaryDecision.BLOCK)blockers.push("CREDENTIAL_BOUNDARY_DID_NOT_BLOCK");
 if(input.adapterAttestation.decision!==ProductionAdapterAttestationDecision.ATTESTED)blockers.push("PRODUCTION_ADAPTER_ABSENCE_NOT_ATTESTED");
 if(input.attempt.deploymentAllowed!==false||input.attempt.productionMutationAllowed!==false)blockers.push("INVALID_DEPLOYMENT_ATTEMPT_AUTHORITY");
 if(!input.attempt.blockers.includes("DEPLOYMENT_HARD_BLOCK_ACTIVE"))blockers.push("DEPLOYMENT_HARD_BLOCK_EVIDENCE_MISSING");
 return Object.freeze({attemptId:input.attempt.attemptId,candidateId:input.expectedCandidateId,decision:blockers.length?DeploymentEvidenceChainDecision.INVALID:DeploymentEvidenceChainDecision.COMPLETE_BLOCKED,productionMutationAllowed:false,deploymentAllowed:false,blockers:Object.freeze(blockers.sort()),evaluatedAtMs:input.nowMs});
}
