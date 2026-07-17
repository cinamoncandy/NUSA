import { SyntheticReleaseRevocationDecision, type SyntheticReleaseRevocationResult } from "./synthetic-release-revocation";
import { type EvidenceGraphHashSeal } from "./evidence-graph-seal";

export enum SyntheticReleaseStatusDecision { ACTIVE_SYNTHETIC_ONLY="ACTIVE_SYNTHETIC_ONLY", REVOKED="REVOKED", INCOMPLETE="INCOMPLETE" }
export interface SyntheticReleaseStatusResult { readonly envelopeId:string;readonly candidateId:string;readonly decision:SyntheticReleaseStatusDecision;readonly graphHash:string|null;readonly blockers:readonly string[];readonly deploymentAllowed:false;readonly productionMutationAllowed:false;readonly evaluatedAtMs:number; }

export function aggregateSyntheticReleaseStatus(input:{readonly envelopeId:string;readonly candidateId:string;readonly revocation?:SyntheticReleaseRevocationResult;readonly graphSeal?:EvidenceGraphHashSeal;readonly graphSealVerified:boolean;readonly revocationEvidencePresent:boolean;readonly nowMs:number;}):SyntheticReleaseStatusResult{
 if(!input.envelopeId.trim()||!input.candidateId.trim()||!Number.isSafeInteger(input.nowMs)||input.nowMs<0)throw new Error("valid synthetic release status context is required");
 const blockers:string[]=[];
 if(!input.revocation)blockers.push("REVOCATION_EVALUATION_MISSING");
 if(!input.graphSeal)blockers.push("EVIDENCE_GRAPH_SEAL_MISSING");
 if(input.revocation&&input.revocation.envelopeId!==input.envelopeId)blockers.push("REVOCATION_ENVELOPE_MISMATCH");
 if(input.revocation&&input.revocation.candidateId!==input.candidateId)blockers.push("REVOCATION_CANDIDATE_MISMATCH");
 if(input.graphSeal&&input.graphSeal.candidateId!==input.candidateId)blockers.push("GRAPH_SEAL_CANDIDATE_MISMATCH");
 if(!input.graphSealVerified)blockers.push("EVIDENCE_GRAPH_SEAL_UNVERIFIED");
 let decision=SyntheticReleaseStatusDecision.INCOMPLETE;
 if(input.revocation?.decision===SyntheticReleaseRevocationDecision.REVOKED){decision=SyntheticReleaseStatusDecision.REVOKED;if(!input.revocationEvidencePresent)blockers.push("REVOCATION_EVIDENCE_MISSING");}
 else if(blockers.length===0&&input.revocation?.decision===SyntheticReleaseRevocationDecision.ACTIVE_SYNTHETIC_ONLY)decision=SyntheticReleaseStatusDecision.ACTIVE_SYNTHETIC_ONLY;
 return Object.freeze({envelopeId:input.envelopeId,candidateId:input.candidateId,decision,graphHash:input.graphSeal?.graphHash??null,blockers:Object.freeze([...new Set(blockers)].sort()),deploymentAllowed:false,productionMutationAllowed:false,evaluatedAtMs:input.nowMs});
}
