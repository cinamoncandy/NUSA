export enum IndependentApprovalDecision { VALID="VALID", INVALID="INVALID" }
export interface IndependentApprovalInput { readonly approvalId:string;readonly candidateId:string;readonly requesterId:string;readonly approverId:string;readonly verifierId:string;readonly approved:boolean;readonly approvedAtMs:number; }
export interface IndependentApprovalResult { readonly approvalId:string;readonly candidateId:string;readonly decision:IndependentApprovalDecision;readonly blockers:readonly string[];readonly approvedAtMs:number; }
export function evaluateIndependentApproval(input:IndependentApprovalInput):IndependentApprovalResult{
 if(!input.approvalId.trim()||!input.candidateId.trim()||!input.requesterId.trim()||!input.approverId.trim()||!input.verifierId.trim()||!Number.isSafeInteger(input.approvedAtMs)||input.approvedAtMs<0)throw new Error("valid approval identity and time are required");
 const blockers:string[]=[];
 if(!input.approved)blockers.push("APPROVAL_NOT_GRANTED");
 if(input.requesterId===input.approverId)blockers.push("REQUESTER_APPROVER_NOT_SEPARATED");
 if(input.approverId===input.verifierId)blockers.push("APPROVER_VERIFIER_NOT_SEPARATED");
 if(input.requesterId===input.verifierId)blockers.push("REQUESTER_VERIFIER_NOT_SEPARATED");
 return Object.freeze({approvalId:input.approvalId,candidateId:input.candidateId,decision:blockers.length?IndependentApprovalDecision.INVALID:IndependentApprovalDecision.VALID,blockers:Object.freeze(blockers.sort()),approvedAtMs:input.approvedAtMs});
}
