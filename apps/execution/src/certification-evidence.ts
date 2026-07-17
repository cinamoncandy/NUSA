import type { DatabaseSync } from "node:sqlite";
import type { BurnInResult } from "./burn-in-harness";
import type { SyntheticCertificationReport } from "./synthetic-certification-report";

type Row = Record<string, string | number | bigint | null>;
const parseArray = (value: unknown): readonly string[] => Object.freeze(JSON.parse(String(value)) as string[]);

export class SqliteBurnInEvidenceRepository {
  public constructor(private readonly db: DatabaseSync) {}
  public append(result: BurnInResult): BurnInResult {
    const existing = this.get(result.runId);
    if (existing != null) throw new Error("duplicate burn-in run id");
    this.db.prepare("INSERT INTO burn_in_evidence (run_id, decision, sample_count, duration_ms, critical_failure_samples, unknown_samples, blocking_reasons_json, final_invariant_status, completed_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(result.runId, result.decision, result.sampleCount, result.durationMs, result.criticalFailureSamples, result.unknownSamples, JSON.stringify(result.blockingReasons), result.finalInvariantState.status, result.completedAtMs);
    return this.get(result.runId)!;
  }
  public get(runId: string): BurnInResult | undefined {
    const row = this.db.prepare("SELECT * FROM burn_in_evidence WHERE run_id = ?").get(runId) as Row | undefined;
    if (row == null) return undefined;
    return Object.freeze({ runId:String(row.run_id), decision:String(row.decision) as BurnInResult["decision"], sampleCount:Number(row.sample_count), durationMs:Number(row.duration_ms), criticalFailureSamples:Number(row.critical_failure_samples), unknownSamples:Number(row.unknown_samples), blockingReasons:parseArray(row.blocking_reasons_json), finalInvariantState:Object.freeze({ status:String(row.final_invariant_status), warningFailureIds:Object.freeze([]), criticalFailureIds:Object.freeze([]), unknownIds:Object.freeze([]) }) as BurnInResult["finalInvariantState"], completedAtMs:Number(row.completed_at_ms) });
  }
}

export class SqliteSyntheticCertificationReportRepository {
  public constructor(private readonly db: DatabaseSync, private readonly burnIn: SqliteBurnInEvidenceRepository) {}
  public append(report: SyntheticCertificationReport, burnInRunId: string): SyntheticCertificationReport {
    if (this.get(report.reportId) != null) throw new Error("duplicate certification report id");
    if (this.burnIn.get(burnInRunId) == null) throw new Error("referenced burn-in evidence not found");
    this.db.prepare("INSERT INTO synthetic_certification_reports (report_id, burn_in_run_id, decision, blockers_json, limitations_json, generated_at_ms, production_mutation_allowed) VALUES (?, ?, ?, ?, ?, ?, 0)")
      .run(report.reportId, burnInRunId, report.decision, JSON.stringify(report.blockers), JSON.stringify(report.limitations), report.generatedAtMs);
    return this.get(report.reportId)!;
  }
  public get(reportId: string): SyntheticCertificationReport | undefined {
    const row = this.db.prepare("SELECT * FROM synthetic_certification_reports WHERE report_id = ?").get(reportId) as Row | undefined;
    if (row == null) return undefined;
    if (Number(row.production_mutation_allowed) !== 0) throw new Error("persisted certification report violates production hard block");
    return Object.freeze({ reportId:String(row.report_id), decision:String(row.decision) as SyntheticCertificationReport["decision"], productionMutationAllowed:false, blockers:parseArray(row.blockers_json), limitations:parseArray(row.limitations_json), generatedAtMs:Number(row.generated_at_ms) });
  }
}
