/** Minimum evidence sufficiency / abstention contract for WO-AI-011. */
export interface MinimumEvidencePolicy { readonly minEffectiveSampleSize:number; readonly minObservationWindowMs:number; }
export interface EvidenceSufficiencyInput { readonly effectiveSampleSize:number; readonly observedWindowMs:number; }
export type EvidenceSufficiencyResult={readonly sufficient:true}|{readonly sufficient:false; readonly reasons:readonly ("INSUFFICIENT_EFFECTIVE_SAMPLE_SIZE"|"INSUFFICIENT_OBSERVATION_WINDOW"|"INVALID_POLICY"|"INVALID_INPUT")[]};
function policyValid(p:MinimumEvidencePolicy){return Number.isSafeInteger(p.minEffectiveSampleSize)&&p.minEffectiveSampleSize>0&&Number.isSafeInteger(p.minObservationWindowMs)&&p.minObservationWindowMs>0;}
export function evaluateEvidenceSufficiency(input:EvidenceSufficiencyInput,policy:MinimumEvidencePolicy):EvidenceSufficiencyResult{
 if(!policyValid(policy))return{sufficient:false,reasons:["INVALID_POLICY"]};
 if(!Number.isSafeInteger(input.effectiveSampleSize)||input.effectiveSampleSize<0||!Number.isFinite(input.observedWindowMs)||input.observedWindowMs<0)return{sufficient:false,reasons:["INVALID_INPUT"]};
 const reasons:("INSUFFICIENT_EFFECTIVE_SAMPLE_SIZE"|"INSUFFICIENT_OBSERVATION_WINDOW")[]=[];
 if(input.effectiveSampleSize<policy.minEffectiveSampleSize)reasons.push("INSUFFICIENT_EFFECTIVE_SAMPLE_SIZE");
 if(input.observedWindowMs<policy.minObservationWindowMs)reasons.push("INSUFFICIENT_OBSERVATION_WINDOW");
 return reasons.length?{sufficient:false,reasons:Object.freeze(reasons)}:{sufficient:true};
}
