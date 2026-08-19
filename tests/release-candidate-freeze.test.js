const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const {
  SqliteBurnInEvidenceRepository,
  SqliteSyntheticCertificationReportRepository,
  evaluateReleaseCandidateFreeze,
  ReleaseCandidateFreezeDecision,
  SyntheticCertificationReportDecision,
  BurnInDecision,
  InvariantMonitorStatus
} = require('../dist/apps/execution/src/index.js');

const schema = `
CREATE TABLE burn_in_evidence (run_id TEXT PRIMARY KEY, decision TEXT NOT NULL, sample_count INTEGER NOT NULL, duration_ms INTEGER NOT NULL, critical_failure_samples INTEGER NOT NULL, unknown_samples INTEGER NOT NULL, blocking_reasons_json TEXT NOT NULL, final_invariant_status TEXT NOT NULL, completed_at_ms INTEGER NOT NULL);
CREATE TABLE synthetic_certification_reports (report_id TEXT PRIMARY KEY, burn_in_run_id TEXT NOT NULL, decision TEXT NOT NULL, blockers_json TEXT NOT NULL, limitations_json TEXT NOT NULL, generated_at_ms INTEGER NOT NULL, production_mutation_allowed INTEGER NOT NULL CHECK (production_mutation_allowed = 0));`;

const burnIn = Object.freeze({ runId:'burn-1', decision:BurnInDecision.PASS, sampleCount:10, durationMs:9000, criticalFailureSamples:0, unknownSamples:0, blockingReasons:Object.freeze([]), finalInvariantState:Object.freeze({ status:InvariantMonitorStatus.HEALTHY, warningFailureIds:Object.freeze([]), criticalFailureIds:Object.freeze([]), unknownIds:Object.freeze([]) }), completedAtMs:10000 });
const report = Object.freeze({ reportId:'report-1', decision:SyntheticCertificationReportDecision.PASS_SYNTHETIC_BASELINE, productionMutationAllowed:false, blockers:Object.freeze([]), limitations:Object.freeze(['SYNTHETIC_EVIDENCE_ONLY']), generatedAtMs:11000 });

test('burn-in and certification evidence are append-only and causally linked', () => {
  const db = new DatabaseSync(':memory:'); db.exec(schema);
  const burns = new SqliteBurnInEvidenceRepository(db);
  const reports = new SqliteSyntheticCertificationReportRepository(db, burns);
  assert.equal(burns.append(burnIn).runId, 'burn-1');
  assert.throws(() => burns.append(burnIn), /duplicate burn-in/);
  assert.equal(reports.append(report, 'burn-1').reportId, 'report-1');
  assert.throws(() => reports.append({...report, reportId:'report-2'}, 'missing'), /not found/);
  assert.throws(() => reports.append(report, 'burn-1'), /duplicate certification/);
  assert.equal(reports.get('report-1').productionMutationAllowed, false);
  db.close();
});

test('release candidate freeze blocks head drift and unresolved findings', () => {
  const frozen = evaluateReleaseCandidateFreeze({ candidateId:'rc-1', frozenHeadSha:'abc', currentHeadSha:'abc', report, openCriticalFindings:0, openHighFindings:0, generatedArtifactsClean:true, nowMs:12000 });
  assert.equal(frozen.decision, ReleaseCandidateFreezeDecision.FROZEN);
  assert.equal(frozen.productionMutationAllowed, false);
  const changed = evaluateReleaseCandidateFreeze({ candidateId:'rc-2', frozenHeadSha:'abc', currentHeadSha:'def', report, openCriticalFindings:0, openHighFindings:1, generatedArtifactsClean:false, nowMs:12001 });
  assert.equal(changed.decision, ReleaseCandidateFreezeDecision.BLOCKED);
  assert.deepEqual(changed.blockers, ['GENERATED_ARTIFACTS_DIRTY','HEAD_CHANGED_AFTER_FREEZE','OPEN_HIGH_FINDINGS']);
});
