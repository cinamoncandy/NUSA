const assert = require("node:assert/strict");
const test = require("node:test");
const { StrategyFamilyRegistry, StrategyFamilyRegistryError, CANONICAL_INDEPENDENT_ALPHA_FAMILIES } = require("../dist/apps/cloud/src/strategyFamilyRegistry.js");

const family = { familyId:"microstructure.orderbook-imbalance", name:"Orderbook Imbalance", category:"MICROSTRUCTURE", thesis:"Independent microstructure pressure evidence.", lifecycle:"RESEARCHING" };
const member = { strategyId:"ORDERBOOK_IMBALANCE", version:"1.0.0", familyId:family.familyId, role:"RESEARCH_CANDIDATE" };

test("registers canonical family and member deterministically", () => {
  const a=new StrategyFamilyRegistry(); const b=new StrategyFamilyRegistry();
  const fa=a.registerFamily(family); b.restore([family],[member]); a.registerMember(member);
  assert.equal(fa.fingerprint, b.getFamily(family.familyId).fingerprint);
  assert.deepEqual(a.getFamily(family.familyId), b.getFamily(family.familyId));
});

test("rejects unknown family and invalid family id", () => {
  const r=new StrategyFamilyRegistry();
  assert.throws(()=>r.registerMember(member), e=>e instanceof StrategyFamilyRegistryError && e.code==="UNKNOWN_FAMILY");
  assert.throws(()=>r.registerFamily({...family,familyId:"Bad Family"}), e=>e instanceof StrategyFamilyRegistryError && e.code==="INVALID_FAMILY");
});

test("rejects duplicate family and mismatched member identity", () => {
  const r=new StrategyFamilyRegistry(); r.registerFamily(family); r.registerMember(member);
  assert.throws(()=>r.registerFamily(family), e=>e.code==="DUPLICATE_FAMILY");
  assert.throws(()=>r.registerMember({...member,familyId:"derivatives.funding-persistence"}), e=>e.code==="MEMBER_CONFLICT");
});

test("enforces one champion per family while keeping challenger and research candidate distinct", () => {
  const r=new StrategyFamilyRegistry(); r.registerFamily(family);
  r.registerMember({...member,role:"CHAMPION"});
  r.registerMember({strategyId:"ORDERBOOK_IMBALANCE_CHALLENGER",version:"1.0.0",familyId:family.familyId,role:"CHALLENGER"});
  assert.throws(()=>r.registerMember({strategyId:"ORDERBOOK_IMBALANCE_V2",version:"2.0.0",familyId:family.familyId,role:"CHAMPION"}), e=>e.code==="CHAMPION_CONFLICT");
  assert.equal(r.getFamily(family.familyId).members.length,2);
});

test("canonical independent alpha families are explicit and research-only", () => {
  assert.deepEqual(CANONICAL_INDEPENDENT_ALPHA_FAMILIES.map(x=>x.familyId),["derivatives.funding-persistence","microstructure.orderbook-imbalance"]);
  assert.ok(CANONICAL_INDEPENDENT_ALPHA_FAMILIES.every(x=>x.lifecycle==="RESEARCHING"));
});
