const test=require('node:test');
const assert=require('node:assert/strict');
const {InvariantSeverity,InvariantObservationStatus,evaluateRuntimeInvariants,BurnInDecision,runSyntheticBurnIn,ReadinessCheckStatus,ProductionReadinessDecision,evaluateProductionReadiness,StartupGateDecision,createSyntheticCertificationReport,SyntheticCertificationReportDecision,FinalCertificationDecision}=require('../apps/execution/src/index');

const obs=(id,status,severity=InvariantSeverity.CRITICAL,time=0)=>({invariantId:id,status,severity,observedAtMs:time});

test('invariant monitor separates warning failures from critical and unknown state',()=>{
 const warning=evaluateRuntimeInvariants([obs('warn',InvariantObservationStatus.FAIL,InvariantSeverity.WARNING)]);
 assert.equal(warning.healthy,true);assert.deepEqual(warning.warningFailureIds,['warn']);
 const critical=evaluateRuntimeInvariants([obs('critical',InvariantObservationStatus.FAIL)]);
 assert.equal(critical.healthy,false);assert.deepEqual(critical.criticalFailureIds,['critical']);
 const unknown=evaluateRuntimeInvariants([obs('unknown',InvariantObservationStatus.UNKNOWN)]);
 assert.equal(unknown.healthy,false);assert.deepEqual(unknown.unknownIds,['unknown']);
});

test('burn-in passes sustained healthy samples and fails critical invariant breaches',()=>{
 const policy={requiredSamples:3,minimumDurationMs:2000,maximumCriticalFailures:0,maximumUnknownSamples:0};
 const samples=[0,1000,2000].map((t,i)=>({sampleId:`s${i}`,sequence:i+1,observedAtMs:t,invariants:[obs('single-leader',InvariantObservationStatus.PASS,InvariantSeverity.CRITICAL,t)]}));
 const pass=runSyntheticBurnIn({runId:'burn-pass',samples,policy,nowMs:2000});
 assert.equal(pass.decision,BurnInDecision.PASS);
 const failed=[...samples.slice(0,2),{sampleId:'s2x',sequence:3,observedAtMs:2000,invariants:[obs('single-leader',InvariantObservationStatus.FAIL,InvariantSeverity.CRITICAL,2000)]}];
 assert.equal(runSyntheticBurnIn({runId:'burn-fail',samples:failed,policy,nowMs:2000}).decision,BurnInDecision.FAIL);
});

test('synthetic report can pass baseline but never enables production mutation',()=>{
 const startup={decision:StartupGateDecision.ALLOW_RESTRICTED_START,productionMutationAllowed:false,blockers:[]};
 const readiness=evaluateProductionReadiness({startup,checks:[{id:'all-synthetic',status:ReadinessCheckStatus.PASS,nonWaivable:true}],nowMs:100});
 assert.equal(readiness.decision,ProductionReadinessDecision.READY);
 const burnIn=runSyntheticBurnIn({runId:'burn',samples:[0,1].map((t,i)=>({sampleId:`s${i}`,sequence:i+1,observedAtMs:t,invariants:[obs('safe',InvariantObservationStatus.PASS,InvariantSeverity.CRITICAL,t)]})),policy:{requiredSamples:2,minimumDurationMs:1,maximumCriticalFailures:0,maximumUnknownSamples:0},nowMs:1});
 const certification={decision:FinalCertificationDecision.AUTHORIZED,productionMutationAllowed:true,blockingRequirementIds:[],limitations:[]};
 const report=createSyntheticCertificationReport({reportId:'report',readiness,burnIn,certification,generatedAtMs:101});
 assert.equal(report.decision,SyntheticCertificationReportDecision.PASS_SYNTHETIC_BASELINE);
 assert.equal(report.productionMutationAllowed,false);
 assert.ok(report.limitations.includes('SYNTHETIC_EVIDENCE_ONLY'));
});

test('unknown burn-in evidence defers final synthetic report',()=>{
 const burnIn=runSyntheticBurnIn({runId:'unknown',samples:[{sampleId:'s',sequence:1,observedAtMs:0,invariants:[obs('state',InvariantObservationStatus.UNKNOWN)]}],policy:{requiredSamples:1,minimumDurationMs:0,maximumCriticalFailures:0,maximumUnknownSamples:0},nowMs:0});
 const report=createSyntheticCertificationReport({reportId:'defer',readiness:{decision:ProductionReadinessDecision.READY,productionMutationAllowed:false,blockingCheckIds:[],evaluatedAtMs:0},burnIn,certification:{decision:FinalCertificationDecision.AUTHORIZED,productionMutationAllowed:true,blockingRequirementIds:[],limitations:[]},generatedAtMs:0});
 assert.equal(report.decision,SyntheticCertificationReportDecision.DEFER);
 assert.ok(report.blockers.some(x=>x.includes('UNKNOWN_INVARIANT_SAMPLES')));
});
