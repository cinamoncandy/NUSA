import { runDisasterRecovery, RecoveryStepStatus, type RecoveryDomainResult, type DisasterRecoveryResult } from "./disaster-recovery";
import { DeterministicFaultInjector, FaultAction, FaultPoint, type FaultInjectionResult } from "./fault-injection";

export interface ChaosRecoveryResult { readonly recovery: DisasterRecoveryResult; readonly injections: readonly FaultInjectionResult[]; }

export function runChaosRecovery(input:{readonly runId:string;readonly domains:readonly RecoveryDomainResult[];readonly nowMs:number;readonly injector:DeterministicFaultInjector;}):ChaosRecoveryResult{
  const injections:FaultInjectionResult[]=[];
  const before=input.injector.hit(FaultPoint.BEFORE_CHECKPOINT);if(before)injections.push(before);
  const afterCheckpoint=input.injector.hit(FaultPoint.AFTER_CHECKPOINT);if(afterCheckpoint)injections.push(afterCheckpoint);
  const domains=input.domains.map(domain=>Object.freeze({...domain}));
  const beforeReplay=input.injector.hit(FaultPoint.BEFORE_REPLAY);if(beforeReplay){injections.push(beforeReplay);if(beforeReplay.action===FaultAction.RETURN_UNKNOWN&&domains.length>0)domains[0]=Object.freeze({...domains[0],status:RecoveryStepStatus.UNKNOWN,reason:"fault-injected unknown recovery state"});if(beforeReplay.action===FaultAction.CORRUPT_COUNT&&domains.length>0)domains[0]=Object.freeze({...domains[0],replayedEvents:-1});}
  const recovery=runDisasterRecovery({runId:input.runId,domains,nowMs:input.nowMs});
  const afterReplay=input.injector.hit(FaultPoint.AFTER_REPLAY);if(afterReplay)injections.push(afterReplay);
  return Object.freeze({recovery,injections:Object.freeze(injections)});
}
