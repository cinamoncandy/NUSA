import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateEvidenceSufficiency } from "./aiEvaluationAbstention";
const policy={minEffectiveSampleSize:30,minObservationWindowMs:1000};
describe("evidence abstention",()=>{
 it("passes exact thresholds",()=>assert.deepEqual(evaluateEvidenceSufficiency({effectiveSampleSize:30,observedWindowMs:1000},policy),{sufficient:true}));
 it("abstains when sample or window is insufficient",()=>assert.deepEqual(evaluateEvidenceSufficiency({effectiveSampleSize:1,observedWindowMs:1},policy),{sufficient:false,reasons:["INSUFFICIENT_EFFECTIVE_SAMPLE_SIZE","INSUFFICIENT_OBSERVATION_WINDOW"]}));
 it("fails closed on invalid policy",()=>assert.deepEqual(evaluateEvidenceSufficiency({effectiveSampleSize:30,observedWindowMs:1000},{minEffectiveSampleSize:0,minObservationWindowMs:1000}),{sufficient:false,reasons:["INVALID_POLICY"]}));
});
