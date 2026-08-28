export interface StrategyRollbackInput { readonly now:number; readonly strategyId:string; readonly version:string; readonly previousChampionVersion?:string; readonly maximumDrawdown:number; readonly maximumDrawdownThreshold:number; readonly rollingSharpe:number; readonly minimumRollingSharpe:number; readonly executionQualityScore:number; readonly minimumExecutionQualityScore:number; readonly unresolvedFaultCount:number; readonly partialHedgeRecoveryFailures:number; readonly killSwitchActive:boolean; readonly featureFingerprintMatches:boolean; readonly dataQualityHealthy:boolean; readonly paperAvailabilityRatio:number; readonly minimumAvailabilityRatio:number; readonly strategyDriftDetected:boolean; readonly unresolvedExposure:boolean; }
export interface StrategyRollbackDecision { readonly action:"HOLD"|"SUSPEND"|"ROLLBACK"; readonly strategyId:string; readonly version:string; readonly rollbackTargetVersion?:string; readonly reasons:readonly string[]; readonly decidedAt:number; }
const invalid = (field:string):never => { throw new Error("STRATEGY_ROLLBACK_INVALID_"+field); };
const requireFinite = (value:number, field:string):void => { if(!Number.isFinite(value)) invalid(field+"_NONFINITE"); };
const requireUnitInterval = (value:number, field:string):void => { requireFinite(value,field); if(value<0||value>1) invalid(field+"_RANGE"); };
const requireScore = (value:number, field:string):void => { requireFinite(value,field); if(value<0||value>100) invalid(field+"_RANGE"); };
const requireNonNegativeInteger = (value:number, field:string):void => { if(!Number.isSafeInteger(value)||value<0) invalid(field+"_COUNT"); };
const requireBoolean = (value:boolean, field:string):void => { if(typeof value!=="boolean") invalid(field+"_BOOLEAN"); };

function validateStrategyRollbackInput(input:StrategyRollbackInput):void {
  if(!input||typeof input!=="object") invalid("INPUT");
  if(!Number.isSafeInteger(input.now)||input.now<0||typeof input.strategyId!=="string"||!input.strategyId.trim()||typeof input.version!=="string"||!input.version.trim()) invalid("IDENTITY");
  if(input.previousChampionVersion!==undefined&&(typeof input.previousChampionVersion!=="string"||!input.previousChampionVersion.trim())) invalid("PREVIOUS_CHAMPION_VERSION");
  requireUnitInterval(input.maximumDrawdown,"MAXIMUM_DRAWDOWN");
  requireUnitInterval(input.maximumDrawdownThreshold,"MAXIMUM_DRAWDOWN_THRESHOLD");
  requireFinite(input.rollingSharpe,"ROLLING_SHARPE");
  requireFinite(input.minimumRollingSharpe,"MINIMUM_ROLLING_SHARPE");
  requireScore(input.executionQualityScore,"EXECUTION_QUALITY_SCORE");
  requireScore(input.minimumExecutionQualityScore,"MINIMUM_EXECUTION_QUALITY_SCORE");
  requireNonNegativeInteger(input.unresolvedFaultCount,"UNRESOLVED_FAULT");
  requireNonNegativeInteger(input.partialHedgeRecoveryFailures,"PARTIAL_HEDGE_RECOVERY");
  requireBoolean(input.killSwitchActive,"KILL_SWITCH_ACTIVE");
  requireBoolean(input.featureFingerprintMatches,"FEATURE_FINGERPRINT_MATCHES");
  requireBoolean(input.dataQualityHealthy,"DATA_QUALITY_HEALTHY");
  requireUnitInterval(input.paperAvailabilityRatio,"PAPER_AVAILABILITY_RATIO");
  requireUnitInterval(input.minimumAvailabilityRatio,"MINIMUM_AVAILABILITY_RATIO");
  requireBoolean(input.strategyDriftDetected,"STRATEGY_DRIFT_DETECTED");
  requireBoolean(input.unresolvedExposure,"UNRESOLVED_EXPOSURE");
}

export function evaluateStrategyRollback(input:StrategyRollbackInput):StrategyRollbackDecision {
  validateStrategyRollbackInput(input);
  const r:string[]=[];
  if(input.killSwitchActive)r.push("KILL_SWITCH");if(input.unresolvedExposure)r.push("UNRESOLVED_EXPOSURE");if(input.unresolvedFaultCount>0)r.push("UNRESOLVED_FAULT");if(input.partialHedgeRecoveryFailures>0)r.push("PARTIAL_HEDGE_RECOVERY_FAILURE");if(!input.featureFingerprintMatches)r.push("FEATURE_DRIFT");if(!input.dataQualityHealthy)r.push("DATA_QUALITY");if(input.strategyDriftDetected)r.push("STRATEGY_DRIFT");if(input.maximumDrawdown>input.maximumDrawdownThreshold)r.push("DRAWDOWN");if(input.rollingSharpe<input.minimumRollingSharpe)r.push("SHARPE");if(input.executionQualityScore<input.minimumExecutionQualityScore)r.push("EXECUTION_QUALITY");if(input.paperAvailabilityRatio<input.minimumAvailabilityRatio)r.push("AVAILABILITY");
  const critical=r.some(x=>["KILL_SWITCH","UNRESOLVED_EXPOSURE","UNRESOLVED_FAULT"].includes(x)); const action=r.length===0?"HOLD":input.previousChampionVersion&&critical?"ROLLBACK":"SUSPEND";
  return Object.freeze({action,strategyId:input.strategyId,version:input.version,rollbackTargetVersion:action==="ROLLBACK"?input.previousChampionVersion:undefined,reasons:Object.freeze(r.sort()),decidedAt:input.now});
}
