import { CredentialBoundaryDecision, type CredentialBoundaryResult } from "./credential-boundary";
import { ProductionAdapterAttestationDecision, type ProductionAdapterAttestation } from "./production-adapter-attestation";
import type { DeploymentAttemptEvidence, SqliteDeploymentAttemptEvidenceRepository } from "./deployment-attempt-evidence";
import type { SqliteCredentialBoundaryEvidenceRepository } from "./credential-boundary-evidence";
import type { SqliteProductionAdapterAttestationRepository } from "./production-adapter-attestation-evidence";

export enum DeploymentEvidenceChainDecision { COMPLETE_BLOCKED="COMPLETE_BLOCKED", INVALID="INVALID" }
export interface DeploymentEvidenceChainResult { readonly attemptId:string;readonly candidateId:string;readonly decision:DeploymentEvidenceChainDecision;readonly productionMutationAllowed:false;readonly deploymentAllowed:false;readonly blockers:readonly string[];readonly evaluatedAtMs:number; }
/**
 * Pure evaluation over three evidence objects. NOTE: on its own this establishes only that the
 * objects handed in are internally consistent — not that any of them was ever durably recorded.
 * Anything that certifies a release must use DeploymentEvidenceChainVerifier below, which loads
 * every input from its append-only repository first.
 */
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

/**
 * Repository-backed deployment evidence chain. Callers pass only identifiers; every piece of
 * evidence is loaded from its append-only store, so a chain can never be certified from
 * hand-constructed in-memory objects. A missing record is itself a blocker rather than an
 * exception, so the absence of evidence is recorded as a denial rather than silently aborting.
 */
export class DeploymentEvidenceChainVerifier {
 public constructor(
  private readonly attempts:SqliteDeploymentAttemptEvidenceRepository,
  private readonly boundaries:SqliteCredentialBoundaryEvidenceRepository,
  private readonly attestations:SqliteProductionAdapterAttestationRepository
 ){}

 public verify(input:{readonly attemptId:string;readonly credentialBoundaryEvaluationId:string;readonly adapterAttestationId:string;readonly expectedCandidateId:string;readonly nowMs:number;}):DeploymentEvidenceChainResult{
  if(!input.expectedCandidateId.trim()||!Number.isSafeInteger(input.nowMs)||input.nowMs<0)throw new Error("valid deployment evidence chain identity and time are required");
  const attempt=this.attempts.get(input.attemptId);
  const boundary=this.boundaries.get(input.credentialBoundaryEvaluationId);
  const attestation=this.attestations.get(input.adapterAttestationId);
  const missing:string[]=[];
  if(!attempt)missing.push("DEPLOYMENT_ATTEMPT_EVIDENCE_NOT_RECORDED");
  if(!boundary)missing.push("CREDENTIAL_BOUNDARY_EVIDENCE_NOT_RECORDED");
  if(!attestation)missing.push("PRODUCTION_ADAPTER_ATTESTATION_NOT_RECORDED");
  if(missing.length)return Object.freeze({attemptId:input.attemptId,candidateId:input.expectedCandidateId,decision:DeploymentEvidenceChainDecision.INVALID,productionMutationAllowed:false,deploymentAllowed:false,blockers:Object.freeze(missing.sort()),evaluatedAtMs:input.nowMs});
  return evaluateDeploymentEvidenceChain({attempt:attempt!,credentialBoundary:boundary!,adapterAttestation:attestation!,expectedCandidateId:input.expectedCandidateId,nowMs:input.nowMs});
 }
}
