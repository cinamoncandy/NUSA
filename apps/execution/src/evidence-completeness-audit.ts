export enum EvidenceCompletenessDecision { COMPLETE="COMPLETE", INCOMPLETE="INCOMPLETE" }
export interface EvidenceRequirement { readonly id:string;readonly present:boolean;readonly candidateId?:string; }
export interface EvidenceCompletenessAuditResult { readonly auditId:string;readonly candidateId:string;readonly decision:EvidenceCompletenessDecision;readonly productionMutationAllowed:false;readonly missingRequirementIds:readonly string[];readonly mismatchedRequirementIds:readonly string[];readonly evaluatedAtMs:number; }
export function auditEvidenceCompleteness(input:{readonly auditId:string;readonly candidateId:string;readonly requirements:readonly EvidenceRequirement[];readonly nowMs:number;}):EvidenceCompletenessAuditResult{
 if(!input.auditId.trim()||!input.candidateId.trim()||!Number.isSafeInteger(input.nowMs)||input.nowMs<0)throw new Error("valid evidence audit identity and time are required");
 const ids=new Set<string>();const missing:string[]=[];const mismatched:string[]=[];
 for(const requirement of input.requirements){if(!requirement.id.trim()||ids.has(requirement.id))throw new Error("duplicate or empty evidence requirement id");ids.add(requirement.id);if(!requirement.present)missing.push(requirement.id);if(requirement.candidateId!=null&&requirement.candidateId!==input.candidateId)mismatched.push(requirement.id);}
 if(input.requirements.length===0)missing.push("NO_REQUIREMENTS_DECLARED");
 return Object.freeze({auditId:input.auditId,candidateId:input.candidateId,decision:missing.length||mismatched.length?EvidenceCompletenessDecision.INCOMPLETE:EvidenceCompletenessDecision.COMPLETE,productionMutationAllowed:false,missingRequirementIds:Object.freeze(missing.sort()),mismatchedRequirementIds:Object.freeze(mismatched.sort()),evaluatedAtMs:input.nowMs});
}
