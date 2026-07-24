export enum FaultPoint {
  BEFORE_CHECKPOINT="BEFORE_CHECKPOINT",
  AFTER_CHECKPOINT="AFTER_CHECKPOINT",
  BEFORE_REPLAY="BEFORE_REPLAY",
  AFTER_REPLAY="AFTER_REPLAY",
  BEFORE_STARTUP_GATE="BEFORE_STARTUP_GATE",
  AFTER_STARTUP_GATE="AFTER_STARTUP_GATE"
}
export enum FaultAction { NONE="NONE", THROW="THROW", RETURN_UNKNOWN="RETURN_UNKNOWN", CORRUPT_COUNT="CORRUPT_COUNT" }
export interface FaultScenario { readonly scenarioId:string; readonly point:FaultPoint; readonly action:FaultAction; readonly occurrence:number; }
export interface FaultInjectionResult { readonly scenarioId:string; readonly point:FaultPoint; readonly action:FaultAction; readonly triggered:boolean; readonly occurrence:number; }
export class DeterministicFaultInjector {
  private readonly seen=new Map<FaultPoint,number>();
  public constructor(private readonly scenarios:readonly FaultScenario[]){
    const ids=new Set<string>();
    for(const s of scenarios){if(!s.scenarioId.trim()||!Number.isSafeInteger(s.occurrence)||s.occurrence<=0)throw new Error("invalid fault scenario");if(ids.has(s.scenarioId))throw new Error("duplicate fault scenario id");ids.add(s.scenarioId);}
  }
  public hit(point:FaultPoint):FaultInjectionResult|undefined{
    const occurrence=(this.seen.get(point)??0)+1;this.seen.set(point,occurrence);
    const scenario=this.scenarios.find(s=>s.point===point&&s.occurrence===occurrence);
    if(!scenario)return undefined;
    if(scenario.action===FaultAction.THROW)throw new Error(`fault injected: ${scenario.scenarioId}`);
    return Object.freeze({...scenario,triggered:true});
  }
}
