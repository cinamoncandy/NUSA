"use strict";
const test=require("node:test");const assert=require("node:assert/strict");
const{AbstentionError,assessAbstention}=require("../dist/apps/desktop/src/cloud/abstentionEngine.js");

function regime(state="HEALTHY"){return{schemaVersion:1,asOf:123,state,score:.8,components:{breadth:.8,medianReturn:.03,medianDrawdown:-.04,medianVolatility:.02,dispersion:.01},reasons:["x"],sourceDatasetIds:["dataset-a"]};}
function evidence(overrides={}){return{regime:regime(),expectedEdge:.01,confidence:.8,estimatedRoundTripCost:.002,evidenceSampleCount:100,stale:false,...overrides};}

test("healthy evidence may proceed when net edge, confidence, and sample count pass",()=>{const a=assessAbstention(evidence());assert.equal(a.decision,"PROCEED_RESEARCH");assert.deepEqual(a.reasons,[]);assert.equal(a.netExpectedEdge,.008);assert.deepEqual(a.sourceDatasetIds,["dataset-a"]);});

test("stressed regime always abstains even with strong candidate evidence",()=>{const a=assessAbstention(evidence({regime:regime("STRESSED"),expectedEdge:.05,confidence:.99}));assert.equal(a.decision,"ABSTAIN");assert.ok(a.reasons.includes("STRESSED_REGIME"));});

test("mixed regime requires a confidence premium",()=>{const a=assessAbstention(evidence({regime:regime("MIXED"),confidence:.65}));assert.equal(a.effectiveMinimumConfidence,.7);assert.equal(a.decision,"ABSTAIN");assert.ok(a.reasons.includes("INSUFFICIENT_CONFIDENCE"));const b=assessAbstention(evidence({regime:regime("MIXED"),confidence:.75}));assert.equal(b.decision,"PROCEED_RESEARCH");});

test("costs are deducted before deciding whether edge exists",()=>{const a=assessAbstention(evidence({expectedEdge:.003,estimatedRoundTripCost:.002}));assert.equal(a.netExpectedEdge,.001);assert.equal(a.decision,"ABSTAIN");assert.ok(a.reasons.includes("INSUFFICIENT_NET_EDGE"));});

test("stale or thin evidence fails closed",()=>{const stale=assessAbstention(evidence({stale:true}));assert.equal(stale.decision,"ABSTAIN");assert.ok(stale.reasons.includes("STALE_EVIDENCE"));const thin=assessAbstention(evidence({evidenceSampleCount:29}));assert.equal(thin.decision,"ABSTAIN");assert.ok(thin.reasons.includes("INSUFFICIENT_SAMPLE_COUNT"));});

test("malformed evidence is rejected",()=>{assert.throws(()=>assessAbstention(evidence({confidence:1.1})),e=>e instanceof AbstentionError&&e.code==="INVALID_CONFIDENCE");assert.throws(()=>assessAbstention(evidence({estimatedRoundTripCost:-.1})),e=>e instanceof AbstentionError&&e.code==="INVALID_COST");assert.throws(()=>assessAbstention(evidence({expectedEdge:Number.NaN})),e=>e instanceof AbstentionError&&e.code==="NON_FINITE_EVIDENCE");});
