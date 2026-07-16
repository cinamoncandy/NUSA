export enum RecoveryStepStatus { PASS="PASS", FAIL="FAIL", UNKNOWN="UNKNOWN" }
export enum DisasterRecoveryDecision { CONSISTENT="CONSISTENT", SAFE_BLOCK="SAFE_BLOCK" }
export interface RecoveryDomainResult { readonly domain:string; readonly status:RecoveryStepStatus; readonly checkpoint:string; readonly replayedEvents:number; readonly reason?:string; }
export interface DisasterRecoveryResult { readonly runId:string; readonly decision:DisasterRecoveryDecision; readonly domains:readonly RecoveryDomainResult[]; readonly blockingDomains:readonly string[]; readonly completedAtMs:number; }
export function runDisasterRecovery(input:{readonly runId:string;readonly domains:readonly RecoveryDomainResult[];readonly nowMs:number;}):DisasterRecoveryResult{
 if(!input.runId.trim()||!Number.isSafeInteger(input.nowMs)||input.nowMs<0)throw new Error("valid recovery identity and time are required");
 if(input.domains.length===0)throw new Error("at least one recovery domain is required");
 const names=new Set<string>();
 for(const d of input.domains){if(!d.domain.trim()||!d.checkpoint.trim()||!Number.isSafeInteger(d.replayedEvents)||d.replayedEvents<0)throw new Error("invalid recovery domain");if(names.has(d.domain))throw new Error("duplicate recovery domain");names.add(d.domain);}
 const ordered=Object.freeze([...input.domains].sort((a,b)=>a.domain.localeCompare(b.domain)).map(d=>Object.freeze({...d})));
 const blocking=Object.freeze(ordered.filter(d=>d.status!==RecoveryStepStatus.PASS).map(d=>d.domain));
 return Object.freeze({runId:input.runId,decision:blocking.length?DisasterRecoveryDecision.SAFE_BLOCK:DisasterRecoveryDecision.CONSISTENT,domains:ordered,blockingDomains:blocking,completedAtMs:input.nowMs});
}
