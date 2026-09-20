import { createHash } from "node:crypto";

export type ResearchEvidenceKind = "REAL" | "SYNTHETIC";
export type ResearchIntegrityStatus = "VALID" | "INVALID";

export interface PointInTimeBoundary {
  readonly observedAt: number;
  readonly availableAt: number;
  readonly decisionAt: number;
  readonly featureCutoff: number;
}

export interface ResearchSegment {
  readonly id: string;
  readonly startAt: number;
  readonly endAt: number;
}

export interface FeatureIdentity {
  readonly featureId: string;
  readonly featureVersion: string;
  readonly datasetFingerprint: string;
  readonly inputCutoff: number;
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
}

export interface ResearchEvidenceProvenance {
  readonly evidenceKind: ResearchEvidenceKind;
  readonly datasetFingerprint: string;
  readonly featureFingerprint: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly familyId: string;
  readonly engineVersion: string;
  readonly gitCommitSha: string;
  readonly researchRunId: string;
  readonly createdAt: string;
}

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const canonical = (value: unknown): string => {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
};

export function validatePointInTimeBoundary(boundary: PointInTimeBoundary): void {
  for (const [name, value] of Object.entries(boundary)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`INVALID_POINT_IN_TIME:${name}`);
  }
  if (boundary.observedAt > boundary.availableAt) throw new Error("FUTURE_LEAKAGE:observed_after_available");
  if (boundary.availableAt > boundary.decisionAt) throw new Error("FUTURE_LEAKAGE:unavailable_at_decision");
  if (boundary.featureCutoff > boundary.decisionAt) throw new Error("FUTURE_LEAKAGE:feature_cutoff_after_decision");
  if (boundary.featureCutoff < boundary.observedAt) throw new Error("INVALID_POINT_IN_TIME:feature_cutoff_before_observation");
}

export function featureFingerprint(identity: FeatureIdentity): string {
  if (!identity.featureId.trim() || !identity.featureVersion.trim()) throw new Error("INVALID_FEATURE_IDENTITY");
  if (!/^[0-9a-f]{64}$/.test(identity.datasetFingerprint)) throw new Error("INVALID_DATASET_FINGERPRINT");
  if (!Number.isSafeInteger(identity.inputCutoff) || identity.inputCutoff < 0) throw new Error("INVALID_FEATURE_CUTOFF");
  return sha256(canonical(identity));
}

export function assertFeatureBinding(identity: FeatureIdentity, expectedDatasetFingerprint: string, expectedFingerprint: string): void {
  if (identity.datasetFingerprint !== expectedDatasetFingerprint) throw new Error("DATASET_FINGERPRINT_MISMATCH");
  if (featureFingerprint(identity) !== expectedFingerprint) throw new Error("FEATURE_FINGERPRINT_MISMATCH");
}

export function assertSegmentIsolation(train: ResearchSegment, validation: ResearchSegment | undefined, oos: ResearchSegment): void {
  const segments = [train, ...(validation == null ? [] : [validation]), oos];
  for (const segment of segments) {
    if (!segment.id.trim() || !Number.isSafeInteger(segment.startAt) || !Number.isSafeInteger(segment.endAt) || segment.startAt >= segment.endAt) {
      throw new Error("INVALID_RESEARCH_SEGMENT");
    }
  }
  for (let left = 0; left < segments.length; left += 1) for (let right = left + 1; right < segments.length; right += 1) {
    const a = segments[left]!, b = segments[right]!;
    if (Math.max(a.startAt, b.startAt) < Math.min(a.endAt, b.endAt)) throw new Error("TRAIN_OOS_CONTAMINATION");
  }
  if (train.endAt > oos.startAt || (validation != null && (train.endAt > validation.startAt || validation.endAt > oos.startAt))) {
    throw new Error("RESEARCH_SEGMENT_ORDER_INVALID");
  }
}

export function oosReuseFingerprint(oos: ResearchSegment, datasetFingerprint: string): string {
  if (!/^[0-9a-f]{64}$/.test(datasetFingerprint)) throw new Error("INVALID_DATASET_FINGERPRINT");
  return sha256(canonical({ datasetFingerprint, oos }));
}

export function validateEvidenceProvenance(provenance: ResearchEvidenceProvenance, options: { promotionEligible?: boolean } = {}): void {
  for (const key of ["strategyId","strategyVersion","familyId","engineVersion","gitCommitSha","researchRunId","createdAt"] as const) {
    if (!provenance[key].trim()) throw new Error(`MISSING_PROVENANCE:${key}`);
  }
  if (!/^[0-9a-f]{64}$/.test(provenance.datasetFingerprint)) throw new Error("MISSING_PROVENANCE:datasetFingerprint");
  if (!/^[0-9a-f]{64}$/.test(provenance.featureFingerprint)) throw new Error("MISSING_PROVENANCE:featureFingerprint");
  if (!/^[0-9a-f]{40}$/.test(provenance.gitCommitSha)) throw new Error("INVALID_PROVENANCE:gitCommitSha");
  if (!Number.isFinite(Date.parse(provenance.createdAt))) throw new Error("INVALID_PROVENANCE:createdAt");
  if (options.promotionEligible === true && provenance.evidenceKind !== "REAL") throw new Error("SYNTHETIC_EVIDENCE_PROMOTION_FORBIDDEN");
}

export function evidenceFingerprint(provenance: ResearchEvidenceProvenance, evidence: unknown): string {
  validateEvidenceProvenance(provenance);
  return sha256(canonical({ provenance, evidence }));
}

export function assertDeterministicReplay(expectedFingerprint: string, provenance: ResearchEvidenceProvenance, replayedEvidence: unknown): void {
  if (evidenceFingerprint(provenance, replayedEvidence) !== expectedFingerprint) throw new Error("REPLAY_NON_DETERMINISTIC");
}
