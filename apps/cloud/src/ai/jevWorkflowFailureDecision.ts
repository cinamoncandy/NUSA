import type { JevShadowProjection } from "./jevShadowRouter";

export const JEV_WORKFLOW_FAILURE_CONTRACT_VERSION = 1 as const;
export type JevFailureOutcome = "CODE" | "TEST" | "INFRA" | "AUTH" | "RUNNER" | "FLAKY" | "UNKNOWN" | "INSUFFICIENT_EVIDENCE" | "ESCALATE";

export interface JevWorkflowFailureStatePacket {
  readonly decisionId: string; readonly taskId: string; readonly executionId: string;
  readonly sourceMainSha: string; readonly stateFingerprint: string;
  readonly workflowName: string; readonly workflowRunId: number; readonly conclusion: "failure" | "timed_out";
  readonly evidenceRefs: readonly string[]; readonly availableActions: readonly ["OBSERVE","ESCALATE"];
  readonly liveAuthority: "NONE"; readonly productionMutationAllowed: false; readonly aiAuthority: "ZERO_AUTHORITY";
}
export interface JevWorkflowFailureReceipt {
  readonly decisionId: string; readonly decisionType: "WORKFLOW_FAILURE_CLASSIFICATION"; readonly contractVersion: 1;
  readonly taskId: string; readonly executionId: string; readonly stateFingerprint: string; readonly sourceMainSha: string;
  readonly inputEvidenceIds: readonly string[]; readonly allowedActions: readonly ["OBSERVE","ESCALATE"];
  readonly selectedOutcome: JevFailureOutcome; readonly confidence: number; readonly reasonCode: string;
  readonly model: string; readonly timestamp: string; readonly escalated: boolean; readonly eventualOutcome: string | null;
  readonly usableForRouting: false; readonly liveAuthority: "NONE"; readonly productionMutationAllowed: false; readonly aiAuthority: "ZERO_AUTHORITY";
}
const SHA=/^[0-9a-f]{40}$/;
const bounded=(v:string,n=160)=>v.trim().slice(0,n);
export function createJevWorkflowFailurePacket(input: Omit<JevWorkflowFailureStatePacket,"availableActions"|"liveAuthority"|"productionMutationAllowed"|"aiAuthority">):JevWorkflowFailureStatePacket {
  if(!bounded(input.decisionId)||!bounded(input.taskId)||!bounded(input.executionId)||!bounded(input.stateFingerprint)) throw new Error("JEV_DECISION_IDENTITY_INVALID");
  if(!SHA.test(input.sourceMainSha)||!Number.isSafeInteger(input.workflowRunId)||input.workflowRunId<=0) throw new Error("JEV_DECISION_EVIDENCE_INVALID");
  if(!input.evidenceRefs.length) throw new Error("JEV_DECISION_EVIDENCE_REQUIRED");
  return Object.freeze({...input,evidenceRefs:Object.freeze([...input.evidenceRefs]),availableActions:Object.freeze(["OBSERVE","ESCALATE"] as const),liveAuthority:"NONE",productionMutationAllowed:false,aiAuthority:"ZERO_AUTHORITY"});
}
export function projectJevWorkflowFailureReceipt(packet:JevWorkflowFailureStatePacket,shadow:JevShadowProjection,model:string,timestamp:string):JevWorkflowFailureReceipt {
  const raw=shadow.decision.rootCause;
  const selectedOutcome:JevFailureOutcome=shadow.fallbackApplied?"INSUFFICIENT_EVIDENCE":raw;
  return Object.freeze({decisionId:packet.decisionId,decisionType:"WORKFLOW_FAILURE_CLASSIFICATION",contractVersion:JEV_WORKFLOW_FAILURE_CONTRACT_VERSION,taskId:packet.taskId,executionId:packet.executionId,stateFingerprint:packet.stateFingerprint,sourceMainSha:packet.sourceMainSha,inputEvidenceIds:packet.evidenceRefs,allowedActions:packet.availableActions,selectedOutcome,confidence:shadow.decision.confidence,reasonCode:shadow.fallbackApplied?"SHADOW_FALLBACK":"SHADOW_CLASSIFIED",model:bounded(model,128)||"unknown",timestamp,escalated:shadow.fallbackApplied,eventualOutcome:null,usableForRouting:false,liveAuthority:"NONE",productionMutationAllowed:false,aiAuthority:"ZERO_AUTHORITY"});
}
export function linkJevWorkflowFailureOutcome(receipt:JevWorkflowFailureReceipt,eventualOutcome:string):JevWorkflowFailureReceipt {
  const outcome=bounded(eventualOutcome,120); if(!outcome) throw new Error("JEV_EVENTUAL_OUTCOME_REQUIRED");
  return Object.freeze({...receipt,eventualOutcome:outcome});
}
