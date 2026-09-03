/** Immutable tail-event family identity for WO-AI-011. */
export type TailEventClass = "GAP_MOVE" | "VOLATILITY_SPIKE" | "LIQUIDITY_STRESS" | "CORRELATION_SPIKE" | "LIMIT_AUCTION_DISRUPTION" | "DISCONTINUOUS_PRICE";
export interface TailEventFamilyDefinition { readonly familyId:string; readonly eventClass:TailEventClass; readonly thresholdValue:number; readonly lookbackWindowMs:number; readonly severityBands:readonly {readonly name:string; readonly minSeverity:number}[]; readonly minEffectiveEventCount:number; readonly frozenAt:number; }
export type TailEventFamilyValidation={readonly valid:true}|{readonly valid:false; readonly errors:readonly string[]};
const isTimestamp=(v:unknown):v is number=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0;
export function validateTailEventFamilyDefinition(family:TailEventFamilyDefinition):TailEventFamilyValidation{
 const errors:string[]=[];
 if(typeof family.familyId!=="string"||!family.familyId.trim())errors.push("MISSING_FAMILY_ID");
 if(!Number.isFinite(family.thresholdValue)||family.thresholdValue<=0)errors.push("INVALID_THRESHOLD");
 if(!Number.isSafeInteger(family.lookbackWindowMs)||family.lookbackWindowMs<=0)errors.push("INVALID_LOOKBACK_WINDOW");
 if(!Number.isSafeInteger(family.minEffectiveEventCount)||family.minEffectiveEventCount<=0)errors.push("INVALID_MIN_EFFECTIVE_EVENT_COUNT");
 if(!isTimestamp(family.frozenAt))errors.push("INVALID_FROZEN_AT");
 if(family.severityBands.length===0)errors.push("EMPTY_SEVERITY_BANDS"); else { const names=new Set<string>(); let previous=-Infinity; for(const b of family.severityBands){ if(typeof b.name!=="string"||!b.name.trim())errors.push("MALFORMED_SEVERITY_BAND_NAME"); else if(names.has(b.name))errors.push("DUPLICATE_SEVERITY_BAND_NAME"); else names.add(b.name); if(!Number.isFinite(b.minSeverity)||b.minSeverity<=previous)errors.push("SEVERITY_BANDS_NOT_STRICTLY_INCREASING"); previous=b.minSeverity; }}
 return errors.length===0?{valid:true}:{valid:false,errors:Object.freeze([...new Set(errors)])};
}
export function isTailEventFamilyConfirmatory(family:TailEventFamilyDefinition,earliestOutcomeObservedAt:number):boolean{
 return validateTailEventFamilyDefinition(family).valid&&isTimestamp(earliestOutcomeObservedAt)&&family.frozenAt<earliestOutcomeObservedAt;
}
