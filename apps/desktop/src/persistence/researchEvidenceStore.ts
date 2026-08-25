import type { DatabaseSync } from "node:sqlite";
import { validateResearchRunManifest, type ResearchRunManifest, type ResearchValidationReport } from "../../../cloud/src/researchRunValidation";

const RESEARCH_RUN_TYPES = new Set(["WALK_FORWARD", "COST_STRESS", "MONTE_CARLO", "INTEGRITY_CHECK"]);
const SHA256 = /^[a-f0-9]{64}$/i;

export function parseResearchManifest(payload: string): ResearchRunManifest {
  try {
    const manifest = Object.freeze(JSON.parse(payload) as ResearchRunManifest);
    validateResearchRunManifest(manifest);
    return manifest;
  } catch (error) { throw new Error("research manifest JSON is invalid", { cause: error }); }
}

export function assertResearchReport(report: ResearchValidationReport): void {
  if (!report.runId.trim() || !RESEARCH_RUN_TYPES.has(report.runType) || !["PASS", "FAIL"].includes(report.status)) throw new Error("research validation report identity is invalid");
  if (!Number.isFinite(Date.parse(report.checkedAt)) || !SHA256.test(report.resultChecksum) || report.reasons.some((reason) => typeof reason !== "string" || !reason.trim())) throw new Error("research validation report content is invalid");
}

export function appendResearchRunManifest(db: DatabaseSync, transaction: <T>(operation: () => T) => T, manifest: ResearchRunManifest): void {
  validateResearchRunManifest(manifest);
  transaction(() => {
    const existing = db.prepare("SELECT manifest_json FROM desktop_research_manifests WHERE run_id = ?").get(manifest.runId) as { manifest_json: string } | undefined;
    const payload = JSON.stringify(manifest);
    if (existing != null) {
      if (existing.manifest_json !== payload) throw new Error("research manifest identity conflict");
      return;
    }
    db.prepare("INSERT INTO desktop_research_manifests (run_id, run_type, strategy_id, strategy_version, dataset_id, dataset_checksum, manifest_json) VALUES (?, ?, ?, ?, ?, ?, ?)").run(manifest.runId, manifest.runType, manifest.strategyId, manifest.strategyVersion, manifest.datasetId, manifest.datasetChecksum, payload);
  });
}

export function loadResearchRunManifests(db: DatabaseSync): readonly ResearchRunManifest[] {
  const rows = db.prepare("SELECT manifest_json FROM desktop_research_manifests ORDER BY run_id ASC").all() as Array<{ manifest_json: string }>;
  return Object.freeze(rows.map((row) => parseResearchManifest(row.manifest_json)));
}

export function appendResearchValidationReport(db: DatabaseSync, transaction: <T>(operation: () => T) => T, report: ResearchValidationReport): void {
  assertResearchReport(report);
  transaction(() => {
    const manifest = db.prepare("SELECT manifest_json FROM desktop_research_manifests WHERE run_id = ?").get(report.runId) as { manifest_json: string } | undefined;
    if (manifest == null) throw new Error("research report manifest is missing");
    const parsedManifest = parseResearchManifest(manifest.manifest_json);
    if (parsedManifest.runType !== report.runType || parsedManifest.resultChecksum !== report.resultChecksum) throw new Error("research report does not match manifest");
    const existing = db.prepare("SELECT report_json FROM desktop_research_reports WHERE run_id = ? AND run_type = ?").get(report.runId, report.runType) as { report_json: string } | undefined;
    const payload = JSON.stringify(report);
    if (existing != null) {
      if (existing.report_json !== payload) throw new Error("research validation report identity conflict");
      return;
    }
    db.prepare("INSERT INTO desktop_research_reports (run_id, run_type, report_json) VALUES (?, ?, ?)").run(report.runId, report.runType, payload);
  });
}

export function appendResearchEvidence(db: DatabaseSync, transaction: <T>(operation: () => T) => T, manifest: ResearchRunManifest, report: ResearchValidationReport): void {
  validateResearchRunManifest(manifest);
  assertResearchReport(report);
  if (manifest.runId !== report.runId || manifest.runType !== report.runType) throw new Error("research evidence manifest/report identity mismatch");
  if (manifest.resultChecksum !== report.resultChecksum) throw new Error("research evidence result checksum mismatch");
  transaction(() => {
    const manifestPayload = JSON.stringify(manifest);
    const reportPayload = JSON.stringify(report);
    const existingManifest = db.prepare("SELECT manifest_json FROM desktop_research_manifests WHERE run_id = ?").get(manifest.runId) as { manifest_json: string } | undefined;
    const existingReport = db.prepare("SELECT report_json FROM desktop_research_reports WHERE run_id = ? AND run_type = ?").get(report.runId, report.runType) as { report_json: string } | undefined;
    if (existingManifest != null && existingManifest.manifest_json !== manifestPayload) throw new Error("research manifest identity conflict");
    if (existingReport != null && existingReport.report_json !== reportPayload) throw new Error("research validation report identity conflict");
    if (existingManifest == null) {
      db.prepare("INSERT INTO desktop_research_manifests (run_id, run_type, strategy_id, strategy_version, dataset_id, dataset_checksum, manifest_json) VALUES (?, ?, ?, ?, ?, ?, ?)").run(manifest.runId, manifest.runType, manifest.strategyId, manifest.strategyVersion, manifest.datasetId, manifest.datasetChecksum, manifestPayload);
    }
    if (existingReport == null) db.prepare("INSERT INTO desktop_research_reports (run_id, run_type, report_json) VALUES (?, ?, ?)").run(report.runId, report.runType, reportPayload);
  });
}

export function loadResearchValidationReports(db: DatabaseSync): readonly ResearchValidationReport[] {
  const rows = db.prepare("SELECT report_json FROM desktop_research_reports ORDER BY run_id ASC, run_type ASC").all() as Array<{ report_json: string }>;
  const manifests = new Map(loadResearchRunManifests(db).map((manifest) => [manifest.runId, manifest]));
  return Object.freeze(rows.map((row) => {
    let report: ResearchValidationReport;
    try { report = Object.freeze(JSON.parse(row.report_json) as ResearchValidationReport); }
    catch (error) { throw new Error("research validation report JSON is invalid", { cause: error }); }
    assertResearchReport(report);
    const manifest = manifests.get(report.runId);
    if (manifest == null || manifest.runType !== report.runType || manifest.resultChecksum !== report.resultChecksum) throw new Error("research report does not match persisted manifest");
    return report;
  }));
}

export function appendResearchEvidenceBundle(db: DatabaseSync, transaction: <T>(operation: () => T) => T, entries: readonly Readonly<{ manifest: ResearchRunManifest; report: ResearchValidationReport }>[]): void {
  if (entries.length === 0) throw new Error("research evidence bundle is empty");
  const seen = new Set<string>();
  for (const entry of entries) {
    validateResearchRunManifest(entry.manifest);
    assertResearchReport(entry.report);
    if (entry.manifest.runId !== entry.report.runId || entry.manifest.runType !== entry.report.runType || entry.manifest.resultChecksum !== entry.report.resultChecksum) {
      throw new Error("research evidence bundle identity mismatch");
    }
    if (seen.has(entry.manifest.runId)) throw new Error("research evidence bundle contains duplicate runId");
    seen.add(entry.manifest.runId);
  }
  transaction(() => {
    for (const entry of entries) {
      const manifestPayload = JSON.stringify(entry.manifest);
      const reportPayload = JSON.stringify(entry.report);
      const existingManifest = db.prepare("SELECT manifest_json FROM desktop_research_manifests WHERE run_id = ?").get(entry.manifest.runId) as { manifest_json: string } | undefined;
      const existingReport = db.prepare("SELECT report_json FROM desktop_research_reports WHERE run_id = ? AND run_type = ?").get(entry.report.runId, entry.report.runType) as { report_json: string } | undefined;
      if (existingManifest != null && existingManifest.manifest_json !== manifestPayload) throw new Error("research manifest identity conflict");
      if (existingReport != null && existingReport.report_json !== reportPayload) throw new Error("research validation report identity conflict");
      if (existingManifest == null) db.prepare("INSERT INTO desktop_research_manifests (run_id, run_type, strategy_id, strategy_version, dataset_id, dataset_checksum, manifest_json) VALUES (?, ?, ?, ?, ?, ?, ?)").run(entry.manifest.runId, entry.manifest.runType, entry.manifest.strategyId, entry.manifest.strategyVersion, entry.manifest.datasetId, entry.manifest.datasetChecksum, manifestPayload);
      if (existingReport == null) db.prepare("INSERT INTO desktop_research_reports (run_id, run_type, report_json) VALUES (?, ?, ?)").run(entry.report.runId, entry.report.runType, reportPayload);
    }
  });
}
