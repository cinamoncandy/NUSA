import { DisasterRecoveryDecision, RecoveryStepStatus, type DisasterRecoveryResult, type RecoveryDomainResult } from "../../../packages/contracts/src/recovery";
export { DisasterRecoveryDecision, RecoveryStepStatus } from "../../../packages/contracts/src/recovery";
export type { DisasterRecoveryResult, RecoveryDomainResult } from "../../../packages/contracts/src/recovery";
export function runDisasterRecovery(input:{readonly runId:string;readonly domains:readonly RecoveryDomainResult[];readonly nowMs:number;}):DisasterRecoveryResult{
 if(!input.runId.trim()||!Number.isSafeInteger(input.nowMs)||input.nowMs<0)throw new Error("valid recovery identity and time are required");
 if(input.domains.length===0)throw new Error("at least one recovery domain is required");
 const names=new Set<string>();
 for(const d of input.domains){if(!d.domain.trim()||!d.checkpoint.trim()||!Number.isSafeInteger(d.replayedEvents)||d.replayedEvents<0)throw new Error("invalid recovery domain");if(names.has(d.domain))throw new Error("duplicate recovery domain");names.add(d.domain);}
 const ordered=Object.freeze([...input.domains].sort((a,b)=>a.domain.localeCompare(b.domain)).map(d=>Object.freeze({...d})));
 const blocking=Object.freeze(ordered.filter(d=>d.status!==RecoveryStepStatus.PASS).map(d=>d.domain));
 return Object.freeze({runId:input.runId,decision:blocking.length?DisasterRecoveryDecision.SAFE_BLOCK:DisasterRecoveryDecision.CONSISTENT,domains:ordered,blockingDomains:blocking,completedAtMs:input.nowMs});
}
