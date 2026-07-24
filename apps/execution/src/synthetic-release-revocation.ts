import { EvidenceGraphIntegrityDecision, type EvidenceGraphIntegrityResult } from "./evidence-graph-integrity";
import { FinalSyntheticReleaseEnvelopeDecision, type FinalSyntheticReleaseEnvelope } from "./final-synthetic-release-envelope";

export enum SyntheticReleaseRevocationDecision { ACTIVE_SYNTHETIC_ONLY="ACTIVE_SYNTHETIC_ONLY", REVOKED="REVOKED" }
export interface SyntheticReleaseRevocationResult { readonly envelopeId:string;readonly candidateId:string;readonly decision:SyntheticReleaseRevocationDecision;readonly productionMutationAllowed:false;readonly deploymentAllowed:false;readonly blockers:readonly string[];readonly evaluatedAtMs:number; }
export function evaluateSyntheticReleaseRevocation(input:{readonly envelope:FinalSyntheticReleaseEnvelope;readonly graph:EvidenceGraphIntegrityResult;readonly currentCandidateId:string;readonly currentHeadSha:string;readonly sealedHeadSha:string;readonly evidenceStillPresent:boolean;readonly nowMs:number;}):SyntheticReleaseRevocationResult{
 if(!input.currentCandidateId.trim()||!input.currentHeadSha.trim()||!input.sealedHeadSha.trim()||!Number.isSafeInteger(input.nowMs)||input.nowMs<0)throw new Error("valid revocation context is required");
 const blockers:string[]=[];
 if(input.envelope.decision!==FinalSyntheticReleaseEnvelopeDecision.SEALED_SYNTHETIC_ONLY)blockers.push("ENVELOPE_NOT_SEALED");
 if(input.envelope.candidateId!==input.currentCandidateId)blockers.push("CANDIDATE_CHANGED_AFTER_SEAL");
 if(input.graph.candidateId!==input.envelope.candidateId)blockers.push("GRAPH_CANDIDATE_MISMATCH");
 if(input.graph.decision!==EvidenceGraphIntegrityDecision.INTACT)blockers.push("EVIDENCE_GRAPH_BROKEN");
 if(input.currentHeadSha!==input.sealedHeadSha)blockers.push("HEAD_CHANGED_AFTER_SEAL");
 if(!input.evidenceStillPresent)blockers.push("SEALED_EVIDENCE_MISSING");
 return Object.freeze({envelopeId:input.envelope.envelopeId,candidateId:input.envelope.candidateId,decision:blockers.length?SyntheticReleaseRevocationDecision.REVOKED:SyntheticReleaseRevocationDecision.ACTIVE_SYNTHETIC_ONLY,productionMutationAllowed:false,deploymentAllowed:false,blockers:Object.freeze(blockers.sort()),evaluatedAtMs:input.nowMs});
}
