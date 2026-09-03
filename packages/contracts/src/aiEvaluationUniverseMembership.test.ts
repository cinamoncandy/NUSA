import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isUniverseMembershipConsistent, resolveUniverseMembership, type UniverseMembershipEvent } from "./aiEvaluationUniverseMembership";
const events:readonly UniverseMembershipEvent[]=[{eventId:"1",symbol:"AAA",type:"ADDED",effectiveAt:1000},{eventId:"2",symbol:"AAA",type:"DELISTED",effectiveAt:5000},{eventId:"3",symbol:"BBB",type:"ADDED",effectiveAt:2000},{eventId:"4",symbol:"CCC",type:"ADDED",effectiveAt:1000},{eventId:"5",symbol:"CCC",type:"REMOVED",effectiveAt:3000},{eventId:"6",symbol:"CCC",type:"ADDED",effectiveAt:4000}];
describe("point-in-time universe membership",()=>{
 it("resolves membership and exits",()=>{assert.deepEqual(resolveUniverseMembership("AAA",2000,events),{member:true});assert.equal(resolveUniverseMembership("AAA",5000,events).member,false);});
 it("handles re-add",()=>assert.deepEqual(resolveUniverseMembership("CCC",4500,events),{member:true}));
 it("requires explicit symbol-change pairing",()=>{const rename:readonly UniverseMembershipEvent[]=[{eventId:"a1",symbol:"AAA",type:"ADDED",effectiveAt:1000},{eventId:"a2",symbol:"AAA",type:"SYMBOL_CHANGED",effectiveAt:2000,renamedTo:"BBB"},{eventId:"b1",symbol:"BBB",type:"ADDED",effectiveAt:2000}];assert.equal(resolveUniverseMembership("AAA",2000,rename).member,false);assert.deepEqual(resolveUniverseMembership("BBB",2000,rename),{member:true});});
 it("rejects inconsistent cohorts",()=>{assert.equal(isUniverseMembershipConsistent([{symbol:"AAA",asOf:2000},{symbol:"BBB",asOf:2500}],events),true);assert.equal(isUniverseMembershipConsistent([],events),false);});
});
