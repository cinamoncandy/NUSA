import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateTailEventFamilyDefinition, isTailEventFamilyConfirmatory, type TailEventFamilyDefinition } from "./aiEvaluationTailEventIdentity";
const family=(overrides:Partial<TailEventFamilyDefinition>={}):TailEventFamilyDefinition=>({familyId:"t",eventClass:"VOLATILITY_SPIKE",thresholdValue:3,lookbackWindowMs:1000,severityBands:[{name:"MOD",minSeverity:3},{name:"SEV",minSeverity:5}],minEffectiveEventCount:10,frozenAt:1,...overrides});
describe("tail event identity",()=>{
 it("validates frozen identity",()=>assert.deepEqual(validateTailEventFamilyDefinition(family()),{valid:true}));
 it("rejects malformed thresholds",()=>assert.equal(validateTailEventFamilyDefinition(family({thresholdValue:0})).valid,false));
 it("requires freeze before outcome inspection",()=>{assert.equal(isTailEventFamilyConfirmatory(family({frozenAt:1}),2),true);assert.equal(isTailEventFamilyConfirmatory(family({frozenAt:2}),2),false);});
});
