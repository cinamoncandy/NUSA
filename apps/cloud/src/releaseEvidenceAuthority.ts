import type { OperatorEvidenceBundle } from "./operatorEvidenceBundle";
import type { OwnerReviewRecord, ReleaseEvidenceDashboard } from "./releaseEvidenceDashboard";
import { allResearchGatesPassed, type ResearchRunManifest, type ResearchValidationReport } from "./researchRunValidation";

export interface ValidationTarget {
  readonly targetId: string;
  readonly validationProfile: "CALENDAR_30_DAY" | "SCENARIO_BASED";
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly parameterChecksum: string;
  readonly datasetId: string;
  readonly datasetChecksum: string;
  readonly codeVersion: string;
  readonly policyVersion: string;
  readonly createdAt: string;
  readonly targetChecksum: string;
}

export type AuthorityStatus = "BLOCKED" | "READY_FOR_OWNER_REVIEW" | "APPROVED";

export interface ReleaseAuthorityResult {
  readonly status: AuthorityStatus;
  readonly target: ValidationTarget;
  readonly blockers: readonly string[];
  readonly validatedReports: readonly ResearchValidationReport[];
  readonly matchingOwnerReview?: OwnerReviewRecord;
  readonly evaluatedAt: string;
}

function sameTarget(manifest: ResearchRunManifest, target: ValidationTarget): boolean {
  return manifest.strategyId === target.strategyId && manifest.strategyVersion === target.strategyVersion && manifest.datasetId === target.datasetId && manifest.datasetChecksum === target.datasetChecksum;
}

export function evaluateAuthoritativeRelease(input: {
  readonly target: ValidationTarget;
  readonly bundle: OperatorEvidenceBundle;
  readonly dashboard: ReleaseEvidenceDashboard;
  readonly manifests: readonly ResearchRunManifest[];
  readonly reports: readonly ResearchValidationReport[];
  readonly reviews: readonly OwnerReviewRecord[];
  readonly evaluatedAt: string;
}): ReleaseAuthorityResult {
  const blockers: string[] = [];
  const { target, bundle } = input;
  if (!target.targetId || !target.targetChecksum || !Number.isFinite(Date.parse(target.createdAt))) blockers.push("INVALID_TARGET");
  if (bundle.validationProfile !== target.validationProfile || bundle.targetStrategy.strategyId !== target.strategyId || bundle.targetStrategy.strategyVersion !== target.strategyVersion || bundle.targetDataset.datasetId !== target.datasetId || bundle.targetDataset.datasetChecksum !== target.datasetChecksum || bundle.codeVersion !== target.codeVersion) blockers.push("BUNDLE_TARGET_MISMATCH");
  const manifests = input.manifests.filter((manifest) => sameTarget(manifest, target));
  const manifestIds = new Set(manifests.map((manifest) => manifest.runId));
  const reports = input.reports.filter((report) => manifestIds.has(report.runId));
  if (reports.length !== input.reports.length) blockers.push("REPORT_TARGET_MISMATCH");
  if (!allResearchGatesPassed(reports)) blockers.push("RESEARCH_VALIDATION_INCOMPLETE");
  if (input.dashboard.bundleChecksum !== bundle.bundleChecksum) blockers.push("DASHBOARD_BUNDLE_MISMATCH");
  if (input.dashboard.releaseStatus !== "READY_FOR_OWNER_REVIEW") blockers.push("DASHBOARD_NOT_READY");
  const matchingOwnerReview = input.reviews.filter((review) => review.bundleChecksum === bundle.bundleChecksum).sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt) || a.reviewId.localeCompare(b.reviewId)).at(-1);
  if (matchingOwnerReview == null) blockers.push("OWNER_REVIEW_MISSING");
  else if (matchingOwnerReview.decision !== "APPROVE") blockers.push(`OWNER_REVIEW_${matchingOwnerReview.decision}`);
  else if (Date.parse(matchingOwnerReview.reviewedAt) < bundle.generatedAt) blockers.push("OWNER_REVIEW_PRECEDES_BUNDLE");
  const uniqueBlockers = Object.freeze([...new Set(blockers)].sort());
  const status: AuthorityStatus = uniqueBlockers.length > 0 ? "BLOCKED" : matchingOwnerReview?.decision === "APPROVE" ? "APPROVED" : "READY_FOR_OWNER_REVIEW";
  return Object.freeze({ status, target, blockers: uniqueBlockers, validatedReports: Object.freeze([...reports]), matchingOwnerReview, evaluatedAt: input.evaluatedAt });
}
