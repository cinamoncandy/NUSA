const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {
 sealEvidenceGraph,verifyEvidenceGraphSeal,
 SqliteSyntheticReleaseRevocationEvidenceRepository,
 aggregateSyntheticReleaseStatus,SyntheticReleaseStatusDecision,
 SyntheticReleaseRevocationDecision
}=require('../dist/apps/execution/src/index.js');

const nodes=[
 {evidenceId:'freeze',kind:'FREEZE',candidateId:'rc-1'},
 {evidenceId:'promotion',kind:'PROMOTION',candidateId:'rc-1'},
];
const edges=[{fromEvidenceId:'freeze',toEvidenceId:'promotion',relation:'ENABLES'}];

test('evidence graph hash seal is deterministic and detects drift',()=>{
 const a=sealEvidenceGraph({sealId:'s1',candidateId:'rc-1',nodes,edges,nowMs:1});
 const b=sealEvidenceGraph({sealId:'s2',candidateId:'rc-1',nodes:[...nodes].reverse(),edges,nowMs:2});
 assert.equal(a.graphHash,b.graphHash);
 assert.equal(verifyEvidenceGraphSeal({seal:a,nodes,edges}),true);
 assert.equal(verifyEvidenceGraphSeal({seal:a,nodes:[...nodes,{evidenceId:'extra',kind:'AUDIT',candidateId:'rc-1'}],edges}),false);
 assert.equal(a.deploymentAllowed,false);
 assert.equal(a.productionMutationAllowed,false);
});

test('revocation evidence is append only and never grants authority',()=>{
 const db=new DatabaseSync(':memory:');
 const repo=new SqliteSyntheticReleaseRevocationEvidenceRepository(db);
 const evidence={revocationId:'r1',envelopeId:'e1',candidateId:'rc-1',previousHeadSha:'aaa',currentHeadSha:'bbb',reasons:['HEAD_CHANGED_AFTER_SEAL'],revokedAtMs:3,deploymentAllowed:false,productionMutationAllowed:false};
 assert.equal(repo.append(evidence).productionMutationAllowed,false);
 assert.throws(()=>repo.append(evidence));
 db.close();
});

test('status aggregator is active only with verified seal and complete active evaluation',()=>{
 const seal=sealEvidenceGraph({sealId:'s1',candidateId:'rc-1',nodes,edges,nowMs:1});
 const active={envelopeId:'e1',candidateId:'rc-1',decision:SyntheticReleaseRevocationDecision.ACTIVE_SYNTHETIC_ONLY,productionMutationAllowed:false,deploymentAllowed:false,blockers:[],evaluatedAtMs:4};
 const result=aggregateSyntheticReleaseStatus({envelopeId:'e1',candidateId:'rc-1',revocation:active,graphSeal:seal,graphSealVerified:true,revocationEvidencePresent:false,nowMs:5});
 assert.equal(result.decision,SyntheticReleaseStatusDecision.ACTIVE_SYNTHETIC_ONLY);
 assert.equal(result.deploymentAllowed,false);
 assert.equal(result.productionMutationAllowed,false);
});

test('revoked status requires persisted revocation evidence',()=>{
 const seal=sealEvidenceGraph({sealId:'s1',candidateId:'rc-1',nodes,edges,nowMs:1});
 const revoked={envelopeId:'e1',candidateId:'rc-1',decision:SyntheticReleaseRevocationDecision.REVOKED,productionMutationAllowed:false,deploymentAllowed:false,blockers:['HEAD_CHANGED_AFTER_SEAL'],evaluatedAtMs:4};
 const missing=aggregateSyntheticReleaseStatus({envelopeId:'e1',candidateId:'rc-1',revocation:revoked,graphSeal:seal,graphSealVerified:true,revocationEvidencePresent:false,nowMs:5});
 assert.equal(missing.decision,SyntheticReleaseStatusDecision.REVOKED);
 assert.ok(missing.blockers.includes('REVOCATION_EVIDENCE_MISSING'));
});
