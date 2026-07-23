import type { DatabaseSync } from "node:sqlite";
import { BurnInDecision, runSyntheticBurnIn, type BurnInPolicy, type BurnInResult, type BurnInSample } from "./burn-in-harness";
import { SyntheticCertificationReportDecision, type SyntheticCertificationReport } from "./synthetic-certification-report";

type Row = Record<string, string | number | bigint | null>;
const parseArray = (value: unknown): readonly string[] => Object.freeze(JSON.parse(String(value)) as string[]);

/**
 * Append-only burn-in evidence.
 *
 * The persisted artifact is the observed sample series plus the policy it was judged against;
 * the PASS/FAIL/INCOMPLETE verdict is derived here by running the real burn-in harness and is
 * re-derived on every read. Two consequences matter for audit:
 *
 * 1. A burn-in pass cannot be fabricated. Recording "10 samples, 0 critical failures, PASS"
 *    requires supplying ten samples that genuinely produce that verdict.
 * 2. The final invariant state is reconstructed from the samples rather than collapsed to a
 *    single status column, so a run that observed critical or unknown invariants still reads
 *    back with those invariant ids intact instead of appearing clean.
 */
export class SqliteBurnInEvidenceRepository {
  public constructor(private readonly db: DatabaseSync) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS burn_in_samples (
        run_id TEXT NOT NULL,
        sample_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        observed_at_ms INTEGER NOT NULL,
        invariants_json TEXT NOT NULL,
        PRIMARY KEY (run_id, sample_id)
      );
      CREATE INDEX IF NOT EXISTS idx_burn_in_samples_run ON burn_in_samples (run_id, sequence);
    `);
    for (const column of ["required_samples", "minimum_duration_ms", "maximum_critical_failures", "maximum_unknown_samples"]) {
      try { this.db.exec(`ALTER TABLE burn_in_evidence ADD COLUMN ${column} INTEGER`); } catch { /* column already present */ }
    }
  }

  public append(input: { readonly runId: string; readonly samples: readonly BurnInSample[]; readonly policy: BurnInPolicy; readonly nowMs: number }): BurnInResult {
    if (this.getRow(input.runId) != null) throw new Error("duplicate burn-in run id");
    const result = runSyntheticBurnIn({ runId: input.runId, samples: input.samples, policy: input.policy, nowMs: input.nowMs });
    this.db.prepare("INSERT INTO burn_in_evidence (run_id, decision, sample_count, duration_ms, critical_failure_samples, unknown_samples, blocking_reasons_json, final_invariant_status, completed_at_ms, required_samples, minimum_duration_ms, maximum_critical_failures, maximum_unknown_samples) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(result.runId, result.decision, result.sampleCount, result.durationMs, result.criticalFailureSamples, result.unknownSamples, JSON.stringify(result.blockingReasons), result.finalInvariantState.status, result.completedAtMs, input.policy.requiredSamples, input.policy.minimumDurationMs, input.policy.maximumCriticalFailures, input.policy.maximumUnknownSamples);
    const insertSample = this.db.prepare("INSERT INTO burn_in_samples (run_id, sample_id, sequence, observed_at_ms, invariants_json) VALUES (?, ?, ?, ?, ?)");
    for (const sample of input.samples) insertSample.run(result.runId, sample.sampleId, sample.sequence, sample.observedAtMs, JSON.stringify(sample.invariants));
    return this.get(result.runId)!;
  }

  public get(runId: string): BurnInResult | undefined {
    const row = this.getRow(runId);
    if (row == null) return undefined;
    if (row.required_samples == null) throw new Error("burn-in evidence predates policy recording and cannot be re-derived");
    const policy: BurnInPolicy = { requiredSamples: Number(row.required_samples), minimumDurationMs: Number(row.minimum_duration_ms), maximumCriticalFailures: Number(row.maximum_critical_failures), maximumUnknownSamples: Number(row.maximum_unknown_samples) };
    const samples = (this.db.prepare("SELECT * FROM burn_in_samples WHERE run_id = ? ORDER BY sequence ASC").all(runId) as Row[])
      .map(s => Object.freeze({ sampleId: String(s.sample_id), sequence: Number(s.sequence), observedAtMs: Number(s.observed_at_ms), invariants: Object.freeze(JSON.parse(String(s.invariants_json))) }) as BurnInSample);
    const rederived = runSyntheticBurnIn({ runId: String(row.run_id), samples, policy, nowMs: Number(row.completed_at_ms) });
    if (rederived.decision !== String(row.decision) || rederived.sampleCount !== Number(row.sample_count) || rederived.durationMs !== Number(row.duration_ms) || rederived.criticalFailureSamples !== Number(row.critical_failure_samples) || rederived.unknownSamples !== Number(row.unknown_samples)) {
      throw new Error("persisted burn-in verdict does not match its recorded samples");
    }
    return rederived;
  }

  private getRow(runId: string): Row | undefined {
    return this.db.prepare("SELECT * FROM burn_in_evidence WHERE run_id = ?").get(runId) as Row | undefined;
  }
}

/**
 * Append-only synthetic certification reports, each causally bound to a recorded burn-in run.
 *
 * Beyond requiring the referenced burn-in to exist, this rejects the one combination the report
 * generator can never actually produce: a PASS_SYNTHETIC_BASELINE report over a burn-in that did
 * not pass. Without that check a genuine burn-in failure could be paired with a passing report
 * and the linkage would still look intact.
 */
export class SqliteSyntheticCertificationReportRepository {
  public constructor(private readonly db: DatabaseSync, private readonly burnIn: SqliteBurnInEvidenceRepository) {}

  public append(report: SyntheticCertificationReport, burnInRunId: string): SyntheticCertificationReport {
    if (this.get(report.reportId) != null) throw new Error("duplicate certification report id");
    const burnIn = this.burnIn.get(burnInRunId);
    if (burnIn == null) throw new Error("referenced burn-in evidence not found");
    if (report.decision === SyntheticCertificationReportDecision.PASS_SYNTHETIC_BASELINE && burnIn.decision !== BurnInDecision.PASS) throw new Error("passing certification report cannot reference a burn-in that did not pass");
    if (report.productionMutationAllowed !== false) throw new Error("certification report must never assert production mutation authority");
    this.db.prepare("INSERT INTO synthetic_certification_reports (report_id, burn_in_run_id, decision, blockers_json, limitations_json, generated_at_ms, production_mutation_allowed) VALUES (?, ?, ?, ?, ?, ?, 0)")
      .run(report.reportId, burnInRunId, report.decision, JSON.stringify(report.blockers), JSON.stringify(report.limitations), report.generatedAtMs);
    return this.get(report.reportId)!;
  }

  public get(reportId: string): SyntheticCertificationReport | undefined {
    const row = this.db.prepare("SELECT * FROM synthetic_certification_reports WHERE report_id = ?").get(reportId) as Row | undefined;
    if (row == null) return undefined;
    if (Number(row.production_mutation_allowed) !== 0) throw new Error("persisted certification report violates production hard block");
    return Object.freeze({ reportId: String(row.report_id), decision: String(row.decision) as SyntheticCertificationReport["decision"], productionMutationAllowed: false, blockers: parseArray(row.blockers_json), limitations: parseArray(row.limitations_json), generatedAtMs: Number(row.generated_at_ms) });
  }
}
