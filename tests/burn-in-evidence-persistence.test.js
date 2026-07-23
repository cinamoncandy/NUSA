const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const {
  SqliteBurnInEvidenceRepository,
  SqliteSyntheticCertificationReportRepository,
  BurnInDecision,
  InvariantMonitorStatus,
  InvariantObservationStatus,
  InvariantSeverity,
  SyntheticCertificationReportDecision
} = require("../apps/execution/src/index");

const schema = `
CREATE TABLE burn_in_evidence (run_id TEXT PRIMARY KEY, decision TEXT NOT NULL, sample_count INTEGER NOT NULL, duration_ms INTEGER NOT NULL, critical_failure_samples INTEGER NOT NULL, unknown_samples INTEGER NOT NULL, blocking_reasons_json TEXT NOT NULL, final_invariant_status TEXT NOT NULL, completed_at_ms INTEGER NOT NULL, required_samples INTEGER, minimum_duration_ms INTEGER, maximum_critical_failures INTEGER, maximum_unknown_samples INTEGER);
CREATE TABLE synthetic_certification_reports (report_id TEXT PRIMARY KEY, burn_in_run_id TEXT NOT NULL, decision TEXT NOT NULL, blockers_json TEXT NOT NULL, limitations_json TEXT NOT NULL, generated_at_ms INTEGER NOT NULL, production_mutation_allowed INTEGER NOT NULL CHECK (production_mutation_allowed = 0));`;

const policy = { requiredSamples: 5, minimumDurationMs: 4000, maximumCriticalFailures: 0, maximumUnknownSamples: 0 };

function sample(i, status = InvariantObservationStatus.PASS, severity = InvariantSeverity.CRITICAL) {
  return { sampleId: `s${i}`, sequence: i, observedAtMs: i * 1000, invariants: [{ invariantId: "ledger-balance", status, severity, observedAtMs: i * 1000 }] };
}

const healthy = Array.from({ length: 5 }, (_, i) => sample(i));

function open() {
  const db = new DatabaseSync(":memory:");
  db.exec(schema);
  const burns = new SqliteBurnInEvidenceRepository(db);
  return { db, burns, reports: new SqliteSyntheticCertificationReportRepository(db, burns) };
}

test("a burn-in pass cannot be recorded without samples that actually produce it", () => {
  const { db, burns } = open();
  // too few samples for the policy: the harness returns INCOMPLETE, and that is what gets stored
  const short = burns.append({ runId: "short", samples: healthy.slice(0, 2), policy, nowMs: 9000 });
  assert.equal(short.decision, BurnInDecision.INCOMPLETE);
  assert.ok(short.blockingReasons.includes("INSUFFICIENT_SAMPLES"));

  const passing = burns.append({ runId: "full", samples: healthy, policy, nowMs: 9000 });
  assert.equal(passing.decision, BurnInDecision.PASS);
  assert.deepEqual(passing.blockingReasons, []);
  db.close();
});

test("a critical invariant failure is not lost or laundered by persistence", () => {
  const { db, burns } = open();
  const withFailure = [...healthy.slice(0, 4), sample(4, InvariantObservationStatus.FAIL, InvariantSeverity.CRITICAL)];
  const stored = burns.append({ runId: "failing", samples: withFailure, policy, nowMs: 9000 });

  assert.equal(stored.decision, BurnInDecision.FAIL);
  assert.equal(stored.criticalFailureSamples, 1);
  assert.equal(stored.finalInvariantState.status, InvariantMonitorStatus.UNHEALTHY);
  // the specific failing invariant id survives the round trip rather than reading back clean
  assert.deepEqual(stored.finalInvariantState.criticalFailureIds, ["ledger-balance"]);
  assert.deepEqual(burns.get("failing").finalInvariantState.criticalFailureIds, ["ledger-balance"]);
  db.close();
});

test("a burn-in verdict edited directly in the database is rejected on read", () => {
  const { db, burns } = open();
  burns.append({ runId: "failing", samples: [...healthy.slice(0, 4), sample(4, InvariantObservationStatus.FAIL, InvariantSeverity.CRITICAL)], policy, nowMs: 9000 });
  db.prepare("UPDATE burn_in_evidence SET decision = ?, critical_failure_samples = 0 WHERE run_id = ?").run(BurnInDecision.PASS, "failing");
  assert.throws(() => burns.get("failing"), /does not match its recorded samples/);
  db.close();
});

test("deleting samples to shorten a run is detected rather than silently accepted", () => {
  const { db, burns } = open();
  burns.append({ runId: "full", samples: healthy, policy, nowMs: 9000 });
  db.prepare("DELETE FROM burn_in_samples WHERE run_id = ? AND sample_id = ?").run("full", "s4");
  assert.throws(() => burns.get("full"), /does not match its recorded samples/);
  db.close();
});

test("a passing certification report cannot reference a burn-in that did not pass", () => {
  const { db, burns, reports } = open();
  burns.append({ runId: "failing", samples: [...healthy.slice(0, 4), sample(4, InvariantObservationStatus.FAIL, InvariantSeverity.CRITICAL)], policy, nowMs: 9000 });
  burns.append({ runId: "full", samples: healthy, policy, nowMs: 9000 });

  const passing = { reportId: "r1", decision: SyntheticCertificationReportDecision.PASS_SYNTHETIC_BASELINE, productionMutationAllowed: false, blockers: [], limitations: ["SYNTHETIC_EVIDENCE_ONLY"], generatedAtMs: 11000 };
  assert.throws(() => reports.append(passing, "failing"), /cannot reference a burn-in that did not pass/);
  assert.throws(() => reports.append(passing, "missing"), /not found/);

  assert.equal(reports.append(passing, "full").decision, SyntheticCertificationReportDecision.PASS_SYNTHETIC_BASELINE);
  // a deferred report over a failed burn-in remains recordable: only the passing claim is constrained
  const deferred = { ...passing, reportId: "r2", decision: SyntheticCertificationReportDecision.DEFER, blockers: ["BURN_IN:CRITICAL_INVARIANT_FAILURES"] };
  assert.equal(reports.append(deferred, "failing").decision, SyntheticCertificationReportDecision.DEFER);
  assert.equal(reports.get("r1").productionMutationAllowed, false);
  db.close();
});
