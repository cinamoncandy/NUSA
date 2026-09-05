import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeCohortAccounting, isFullCohortAccountedFor } from "./aiEvaluationCohortAccounting";
describe("cohort accounting", () => {
  const records=[{predictionId:"p1",status:"RESOLVED" as const},{predictionId:"p2",status:"BANKRUPT" as const},{predictionId:"p3",status:"CENSORED" as const}];
  it("keeps hard cases in the denominator", () => { const r=computeCohortAccounting(records); assert.equal(r.resolved,true); assert.equal((r as {coverageRatio:number}).coverageRatio,1/3); });
  it("detects dropped cohort members", () => assert.equal(isFullCohortAccountedFor(["p1","p2","p3"],records.filter((r)=>r.predictionId!=="p2")),false));
  it("fails closed on duplicates", () => assert.deepEqual(computeCohortAccounting([{predictionId:"p1",status:"RESOLVED"},{predictionId:"p1",status:"BANKRUPT"}]),{resolved:false,reason:"DUPLICATE_PREDICTION_ID"}));
});
