import type { EvidenceBundle } from "./evidenceBundle";
import type { ReleaseReadinessReport } from "./releaseReadinessAudit";

export interface ComplianceReport {
  readonly schemaVersion: 1;
  readonly generatedAt: number;
  readonly title: string;
  readonly mode: "PAPER" | "DRY_RUN";
  readonly readinessStatus: ReleaseReadinessReport["status"];
  readonly readinessScore: number;
  readonly evidenceComplete: boolean;
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly exportFormats: readonly ["JSON", "PDF"];
  readonly automaticSubmissionAllowed: false;
}

export function buildComplianceReport(
  title: string,
  mode: "PAPER" | "DRY_RUN",
  generatedAt: number,
  readiness: ReleaseReadinessReport,
  evidence: EvidenceBundle
): ComplianceReport {
  if (!title.trim()) throw new Error("title is required");
  if (!Number.isSafeInteger(generatedAt) || generatedAt < 0) throw new Error("generatedAt must be a non-negative safe integer");
  const blockers = [...readiness.blockers];
  if (!evidence.complete) blockers.push(`Evidence bundle is incomplete: ${evidence.missing.join(", ")}`);
  return Object.freeze({
    schemaVersion: 1 as const,
    generatedAt,
    title: title.trim(),
    mode,
    readinessStatus: blockers.length > 0 ? "BLOCKED" : readiness.status,
    readinessScore: readiness.score,
    evidenceComplete: evidence.complete,
    blockers: Object.freeze(blockers),
    warnings: Object.freeze([...readiness.warnings]),
    exportFormats: Object.freeze(["JSON", "PDF"] as const),
    automaticSubmissionAllowed: false as const
  });
}
