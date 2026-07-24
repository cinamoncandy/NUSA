import type { OperatorEvidenceBundle } from "./operatorEvidenceBundle";

export type EvidenceStatus = "MISSING" | "IN_PROGRESS" | "PASS" | "FAIL" | "STALE" | "MISMATCH" | "NOT_EVALUATED";
export type ReleaseEvidenceStatus = "BLOCKED" | "READY_FOR_OWNER_REVIEW" | "APPROVED";

export interface EvidenceRequirement {
  readonly status: EvidenceStatus;
  readonly current: number | string;
  readonly required: number | string;
  readonly lastObservedAt: number | null;
  readonly source: string;
  readonly reason: string;
  readonly blocking: boolean;
}

export interface OwnerReviewRecord {
  readonly reviewId: string;
  readonly bundleChecksum: string;
  readonly reviewerId: string;
  readonly decision: "APPROVE" | "REJECT" | "REQUEST_MORE_EVIDENCE";
  readonly note?: string;
  readonly reviewedAt: string;
  readonly recordChecksum: string;
}

export interface ReleaseEvidenceDashboard {
  readonly generatedAt: number;
  readonly operationalEvidenceProgress: number;
  readonly faultScenarioProgress: number;
  readonly researchValidationProgress: number;
  readonly integrityProgress: number;
  readonly ownerReviewProgress: number;
  readonly requirements: Readonly<Record<string, EvidenceRequirement>>;
  readonly ownerReview: EvidenceRequirement;
  readonly releaseStatus: ReleaseEvidenceStatus;
  readonly blockingReasons: readonly string[];
  readonly bundleChecksum: string;
}

const REQUIRED_FAULTS = ["PERSISTENCE_FAILURE", "WEBSOCKET_DISCONNECT", "PARTIAL_WRITE", "DUPLICATE_SIGNAL", "KILL_SWITCH"] as const;
const required = { sessions: 20, orders: 50, regimes: 3, recovery: 3, duplicateChecks: 10 } as const;
const ratio = (current: number, minimum: number): number => minimum <= 0 ? 0 : Math.min(1, Math.max(0, current / minimum));
const statusForCount = (current: number, minimum: number): EvidenceStatus => current >= minimum ? "NOT_EVALUATED" : current > 0 ? "IN_PROGRESS" : "MISSING";
const req = (status: EvidenceStatus, current: number | string, minimum: number | string, source: string, reason: string, lastObservedAt: number | null, blocking = true): EvidenceRequirement => Object.freeze({ status, current, required: minimum, lastObservedAt, source, reason, blocking });

export function buildReleaseEvidenceDashboard(bundle: OperatorEvidenceBundle, now: number, reviews: readonly OwnerReviewRecord[] = []): ReleaseEvidenceDashboard {
  if (!Number.isSafeInteger(now) || now < bundle.generatedAt) throw new Error("dashboard time is invalid");
  const counters = bundle.derivedCounters;
  const eventsHaveProvenance = false;
  const requirements: Record<string, EvidenceRequirement> = {};
  requirements.observedSessions = req(eventsHaveProvenance ? statusForCount(counters.sessionCount, required.sessions) : "NOT_EVALUATED", counters.sessionCount, required.sessions, "SQLITE_EVENT_REPLAY", eventsHaveProvenance ? "validated Paper provenance required" : "event provenance is absent", counters.lastOccurredAt);
  requirements.completedOrders = req(eventsHaveProvenance ? statusForCount(counters.completedOrderCount, required.orders) : "NOT_EVALUATED", counters.completedOrderCount, required.orders, "SQLITE_EVENT_REPLAY", eventsHaveProvenance ? "validated Paper provenance required" : "event provenance is absent", counters.lastOccurredAt);
  requirements.marketRegimes = req(eventsHaveProvenance ? statusForCount(counters.regimeCount, required.regimes) : "NOT_EVALUATED", counters.regimeCount, required.regimes, "SQLITE_EVENT_REPLAY", eventsHaveProvenance ? "validated Paper provenance required" : "event provenance is absent", counters.lastOccurredAt);
  requirements.restartRecoveryPasses = req(eventsHaveProvenance ? statusForCount(counters.recoveryPassCount, required.recovery) : "NOT_EVALUATED", counters.recoveryPassCount, required.recovery, "SQLITE_EVENT_REPLAY", eventsHaveProvenance ? "validated Paper provenance required" : "event provenance is absent", counters.lastOccurredAt);
  requirements.duplicateOrderChecks = req(eventsHaveProvenance ? statusForCount(counters.duplicateOrderCheckCount, required.duplicateChecks) : "NOT_EVALUATED", counters.duplicateOrderCheckCount, required.duplicateChecks, "SQLITE_EVENT_REPLAY", eventsHaveProvenance ? "validated Paper provenance required" : "event provenance is absent", counters.lastOccurredAt);

  for (const scenario of REQUIRED_FAULTS) {
    const present = counters.passedFaultScenarios.includes(scenario);
    requirements[`fault:${scenario}`] = req("NOT_EVALUATED", present ? "PRESENT" : "MISSING", "VERIFIED_OPERATOR_FAULT_DRILL", "SQLITE_EVENT_REPLAY", present ? "fault-drill provenance is not persisted in this bundle" : "required fault scenario is missing", counters.lastOccurredAt);
  }

  const reportTypes = ["WALK_FORWARD", "COST_STRESS", "MONTE_CARLO", "INTEGRITY_CHECK"];
  for (const type of reportTypes) {
    const reports = bundle.researchReports.filter((report) => report.runType === type);
    const latest = reports.at(-1);
    const status: EvidenceStatus = latest == null ? "MISSING" : latest.status === "PASS" ? "PASS" : "FAIL";
    requirements[`research:${type}`] = req(status, latest?.status ?? "MISSING", "PASS", "PERSISTED_RESEARCH_REPORT", latest == null ? "validated report is missing" : latest.status === "PASS" ? "validated persisted report" : "latest validated report failed", null);
  }

  const bundleStatus: EvidenceStatus = bundle.bundleChecksum ? "PASS" : "FAIL";
  requirements.bundleChecksum = req(bundleStatus, bundle.bundleChecksum ? "VALID" : "INVALID", "VALID_SHA256", "IMMUTABLE_BUNDLE", bundleStatus === "PASS" ? "bundle checksum is present" : "bundle checksum is missing", bundle.generatedAt, true);
  const ownerReview = currentOwnerReview(bundle, reviews);
  const blockingReasons = Object.entries(requirements).filter(([, value]) => value.blocking && value.status !== "PASS").map(([key, value]) => `${key}:${value.reason}`);
  if (ownerReview.status !== "PASS") blockingReasons.push(`ownerReview:${ownerReview.reason}`);
  const researchPasses = reportTypes.filter((type) => requirements[`research:${type}`]?.status === "PASS").length;
  const operationalCurrent = [counters.sessionCount, counters.completedOrderCount, counters.regimeCount, counters.recoveryPassCount, counters.duplicateOrderCheckCount];
  const operationalProgress = operationalCurrent.reduce((sum, current, index) => sum + ratio(current, Object.values(required)[index]!), 0) / operationalCurrent.length;
  const faultProgress = REQUIRED_FAULTS.filter((scenario) => requirements[`fault:${scenario}`]?.status === "PASS").length / REQUIRED_FAULTS.length;
  const releaseStatus: ReleaseEvidenceStatus = blockingReasons.length === 0 ? "READY_FOR_OWNER_REVIEW" : "BLOCKED";
  return Object.freeze({
    generatedAt: now,
    operationalEvidenceProgress: operationalProgress,
    faultScenarioProgress: faultProgress,
    researchValidationProgress: researchPasses / reportTypes.length,
    integrityProgress: requirements["research:INTEGRITY_CHECK"]?.status === "PASS" ? 1 : 0,
    ownerReviewProgress: ownerReview.status === "PASS" ? 1 : 0,
    requirements: Object.freeze(requirements),
    ownerReview,
    releaseStatus,
    blockingReasons: Object.freeze(blockingReasons.sort()),
    bundleChecksum: bundle.bundleChecksum
  });
}

function currentOwnerReview(bundle: OperatorEvidenceBundle, reviews: readonly OwnerReviewRecord[]): EvidenceRequirement {
  const matching = reviews.filter((review) => review.bundleChecksum === bundle.bundleChecksum).sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt) || a.reviewId.localeCompare(b.reviewId));
  const latest = matching.at(-1);
  if (latest == null) return req("MISSING", "MISSING", "APPROVE", "PERSISTED_OWNER_REVIEW", "owner review is missing", null);
  if (latest.decision !== "APPROVE") return req("FAIL", latest.decision, "APPROVE", "PERSISTED_OWNER_REVIEW", `owner decision is ${latest.decision}`, Date.parse(latest.reviewedAt));
  if (bundle.releaseReadiness.status !== "READY_FOR_OWNER_REVIEW") return req("FAIL", "APPROVE", "READY_FOR_OWNER_REVIEW", "PERSISTED_OWNER_REVIEW", "bundle was not ready for owner review", Date.parse(latest.reviewedAt));
  return req("PASS", "APPROVE", "APPROVE", "PERSISTED_OWNER_REVIEW", "owner review matches current ready bundle", Date.parse(latest.reviewedAt), false);
}
