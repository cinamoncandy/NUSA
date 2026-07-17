import { StartupGateDecision, type StartupConsistencyResult } from "./startup-consistency-gate";

export enum ReadinessCheckStatus { PASS="PASS", FAIL="FAIL", UNKNOWN="UNKNOWN", STALE="STALE" }
export enum ProductionReadinessDecision { READY="READY", NOT_READY="NOT_READY" }
export interface ProductionReadinessCheck { readonly id:string;readonly status:ReadinessCheckStatus;readonly nonWaivable:boolean;readonly reason?:string; }
export interface ProductionReadinessResult { readonly decision:ProductionReadinessDecision;readonly productionMutationAllowed:false;readonly blockingCheckIds:readonly string[];readonly evaluatedAtMs:number; }
export function evaluateProductionReadiness(input:{readonly startup:StartupConsistencyResult;readonly checks:readonly ProductionReadinessCheck[];readonly nowMs:number;}):ProductionReadinessResult{
 if(!Number.isSafeInteger(input.nowMs)||input.nowMs<0)throw new Error("readiness time is invalid");
 const ids=new Set<string>();for(const c of input.checks){if(!c.id.trim())throw new Error("readiness check id is required");if(ids.has(c.id))throw new Error("duplicate readiness check id");ids.add(c.id);}
 const blocking=input.checks.filter(c=>c.status!==ReadinessCheckStatus.PASS).map(c=>c.id);
 if(input.startup.decision!==StartupGateDecision.ALLOW_RESTRICTED_START)blocking.push("STARTUP_GATE_BLOCKED");
 return Object.freeze({decision:blocking.length?ProductionReadinessDecision.NOT_READY:ProductionReadinessDecision.READY,productionMutationAllowed:false,blockingCheckIds:Object.freeze([...new Set(blocking)].sort()),evaluatedAtMs:input.nowMs});
}
