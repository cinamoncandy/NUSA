import { DisasterRecoveryDecision, type DisasterRecoveryResult } from "./disaster-recovery";

export enum StartupGateDecision { ALLOW_RESTRICTED_START="ALLOW_RESTRICTED_START", BLOCK_START="BLOCK_START" }
export interface StartupConsistencyInput {
  readonly recovery: DisasterRecoveryResult;
  readonly activeRestrictionCount: number;
  readonly unresolvedSubmissionCount: number;
  readonly clockSafe: boolean;
  readonly websocketSynchronized: boolean;
  readonly migrationStateKnown: boolean;
}
export interface StartupConsistencyResult { readonly decision:StartupGateDecision;readonly productionMutationAllowed:false;readonly blockers:readonly string[]; }
export function evaluateStartupConsistency(input:StartupConsistencyInput):StartupConsistencyResult{
 if(!Number.isSafeInteger(input.activeRestrictionCount)||input.activeRestrictionCount<0||!Number.isSafeInteger(input.unresolvedSubmissionCount)||input.unresolvedSubmissionCount<0)throw new Error("startup counts are invalid");
 const blockers:string[]=[];
 if(input.recovery.decision!==DisasterRecoveryDecision.CONSISTENT)blockers.push("RECOVERY_NOT_CONSISTENT");
 if(input.activeRestrictionCount>0)blockers.push("ACTIVE_OPERATIONAL_RESTRICTIONS");
 if(input.unresolvedSubmissionCount>0)blockers.push("UNRESOLVED_SUBMISSIONS");
 if(!input.clockSafe)blockers.push("CLOCK_UNSAFE");
 if(!input.websocketSynchronized)blockers.push("WEBSOCKET_NOT_SYNCHRONIZED");
 if(!input.migrationStateKnown)blockers.push("MIGRATION_STATE_UNKNOWN");
 return Object.freeze({decision:blockers.length?StartupGateDecision.BLOCK_START:StartupGateDecision.ALLOW_RESTRICTED_START,productionMutationAllowed:false,blockers:Object.freeze(blockers.sort())});
}
