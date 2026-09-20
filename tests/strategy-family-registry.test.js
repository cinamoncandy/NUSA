const assert = require("node:assert/strict");
const test = require("node:test");
const { StrategyFamilyRegistry, StrategyFamilyRegistryError, CANONICAL_INDEPENDENT_ALPHA_FAMILIES, CANONICAL_INDEPENDENT_ALPHA_FAMILY_BINDINGS, requireCanonicalIndependentAlphaFamilyBinding } = require("../dist/apps/cloud/src/strategyFamilyRegistry.js");

const family = { familyId:"microstructure.orderbook-imbalance", name:"Orderbook Imbalance", category:"MICROSTRUCTURE", thesis:"Independent microstructure pressure evidence.", lifecycle:"RESEARCHING" };
const fundingFamily = { familyId:"derivatives.funding-persistence", name:"Funding Persistence", category:"DERIVATIVES", thesis:"Independent derivatives carry evidence.", lifecycle:"RESEARCHING" };
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
  const r=new StrategyFamilyRegistry(); r.registerFamily(family); r.registerFamily(fundingFamily); r.registerMember(member);
  assert.throws(()=>r.registerFamily(family), e=>e.code==="DUPLICATE_FAMILY");
  assert.throws(()=>r.registerMember({...member,familyId:fundingFamily.familyId}), e=>e.code==="MEMBER_CONFLICT");
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

test("governance boundary requires exact canonical family membership", () => {
  const r=new StrategyFamilyRegistry(); r.registerFamily(family); r.registerFamily(fundingFamily); r.registerMember(member);
  assert.deepEqual(r.requireMembership(member.strategyId,member.version,family.familyId),member);
  assert.throws(()=>r.requireMembership(member.strategyId,member.version,fundingFamily.familyId), e=>e.code==="MEMBER_CONFLICT");
  assert.throws(()=>r.requireMembership(member.strategyId,member.version,"unknown.family"), e=>e.code==="UNKNOWN_FAMILY");
});


test("suspended and retired families reject new members while preserving restored membership", () => {
  for (const lifecycle of ["SUSPENDED","RETIRED"]) {
    const r=new StrategyFamilyRegistry();
    r.registerFamily({...family,lifecycle});
    assert.throws(()=>r.registerMember(member), e=>e.code==="FAMILY_NOT_ADMITTING_MEMBERS");
  }
  const r=new StrategyFamilyRegistry();
  r.registerFamily(family);
  r.registerMember(member);
  assert.deepEqual(r.getMember(member.strategyId,member.version),member);
});


test("restore replays persisted members for closed families but still blocks new admissions", () => {
  for (const lifecycle of ["SUSPENDED","RETIRED"]) {
    const r=new StrategyFamilyRegistry();
    const closed={...family,lifecycle};
    r.restore([closed],[member]);
    assert.deepEqual(r.requireMembership(member.strategyId,member.version,family.familyId),member);
    assert.throws(()=>r.registerMember({strategyId:"ORDERBOOK_IMBALANCE_NEW",version:"1.0.0",familyId:family.familyId,role:"RESEARCH_CANDIDATE"}), e=>e.code==="FAMILY_NOT_ADMITTING_MEMBERS");
  }
});

test("restore keeps champion uniqueness fail-closed for closed families", () => {
  const r=new StrategyFamilyRegistry();
  const closed={...family,lifecycle:"SUSPENDED"};
  assert.throws(()=>r.restore([closed],[
    {...member,role:"CHAMPION"},
    {strategyId:"ORDERBOOK_IMBALANCE_V2",version:"2.0.0",familyId:family.familyId,role:"CHAMPION"}
  ]), e=>e.code==="CHAMPION_CONFLICT");
});

test("independent alpha bindings are explicit, semver-normalized, and research-candidate only", () => {
  assert.deepEqual(CANONICAL_INDEPENDENT_ALPHA_FAMILY_BINDINGS.map(x=>[x.alphaId,x.alphaVersion,x.strategyVersion,x.familyId,x.role]),[
    ["ORDERBOOK_IMBALANCE",1,"1.0.0","microstructure.orderbook-imbalance","RESEARCH_CANDIDATE"],
    ["FUNDING_PERSISTENCE_MEAN_REVERSION",1,"1.0.0","derivatives.funding-persistence","RESEARCH_CANDIDATE"]
  ]);
  assert.equal(requireCanonicalIndependentAlphaFamilyBinding("ORDERBOOK_IMBALANCE",1).strategyVersion,"1.0.0");
  assert.throws(()=>requireCanonicalIndependentAlphaFamilyBinding("ORDERBOOK_IMBALANCE",2), e=>e.code==="MEMBER_CONFLICT");
});
