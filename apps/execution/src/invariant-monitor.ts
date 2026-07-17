export enum InvariantSeverity { WARNING="WARNING", CRITICAL="CRITICAL" }
export enum InvariantObservationStatus { PASS="PASS", FAIL="FAIL", UNKNOWN="UNKNOWN" }
export enum InvariantMonitorStatus { HEALTHY="HEALTHY", UNHEALTHY="UNHEALTHY" }
export interface RuntimeInvariantObservation { readonly invariantId:string; readonly status:InvariantObservationStatus; readonly severity:InvariantSeverity; readonly observedAtMs:number; readonly reason?:string; }
export interface InvariantMonitorResult { readonly healthy:boolean; readonly status:InvariantMonitorStatus; readonly criticalFailureIds:readonly string[]; readonly warningFailureIds:readonly string[]; readonly unknownIds:readonly string[]; readonly observations:readonly RuntimeInvariantObservation[]; }
export function evaluateRuntimeInvariants(observations:readonly RuntimeInvariantObservation[]):InvariantMonitorResult{
 const ids=new Set<string>();
 const ordered=[...observations].map(o=>{if(!o.invariantId.trim()||!Number.isSafeInteger(o.observedAtMs)||o.observedAtMs<0)throw new Error("invalid invariant observation");if(ids.has(o.invariantId))throw new Error("duplicate invariant id");ids.add(o.invariantId);return Object.freeze({...o});}).sort((a,b)=>a.invariantId.localeCompare(b.invariantId));
 const critical=ordered.filter(o=>o.status===InvariantObservationStatus.FAIL&&o.severity===InvariantSeverity.CRITICAL).map(o=>o.invariantId);
 const warning=ordered.filter(o=>o.status===InvariantObservationStatus.FAIL&&o.severity===InvariantSeverity.WARNING).map(o=>o.invariantId);
 const unknown=ordered.filter(o=>o.status===InvariantObservationStatus.UNKNOWN).map(o=>o.invariantId);
 const healthy=critical.length===0&&unknown.length===0;
 return Object.freeze({healthy,status:healthy?InvariantMonitorStatus.HEALTHY:InvariantMonitorStatus.UNHEALTHY,criticalFailureIds:Object.freeze(critical),warningFailureIds:Object.freeze(warning),unknownIds:Object.freeze(unknown),observations:Object.freeze(ordered)});
}
