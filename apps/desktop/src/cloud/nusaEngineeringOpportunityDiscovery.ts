export type NusaEngineeringOpportunityKind =
  | "CI_FAILURE_FAMILY"
  | "CI_LONG_TAIL"
  | "RECOVERY_GAP"
  | "ARCHITECTURE_DRIFT"
  | "PAPER_EVIDENCE_GAP"
  | "UI_FRICTION"
  | "DEPENDENCY_BOTTLENECK";

export type NusaEngineeringEvidenceState = "VERIFIED" | "UNKNOWN" | "INSUFFICIENT";

export interface NusaEngineeringOpportunitySignal {
  readonly signalId: string;
  readonly kind: NusaEngineeringOpportunityKind;
  readonly subject: string;
  readonly observedAt: number;
  readonly evidenceState: NusaEngineeringEvidenceState;
  readonly occurrences: number;
  readonly sourceFingerprint: string;
  readonly existingIssueNumber?: number | null;
  readonly existingWorkId?: string | null;
}

export interface NusaEngineeringOpportunityCandidate {
  readonly candidateId: string;
  readonly kind: NusaEngineeringOpportunityKind;
  readonly subject: string;
  readonly signalIds: readonly string[];
  readonly evidenceState: NusaEngineeringEvidenceState;
  readonly totalOccurrences: number;
  readonly latestObservedAt: number;
  readonly existingIssueNumber: number | null;
  readonly existingWorkId: string | null;
  readonly action: "CREATE_CANDIDATE" | "DEDUPLICATED" | "HOLD_INSUFFICIENT_EVIDENCE";
  readonly auditReasons: readonly string[];
}

export interface NusaEngineeringOpportunityDiscoveryResult {
  readonly schemaVersion: 1;
  readonly candidates: readonly NusaEngineeringOpportunityCandidate[];
  readonly discoveredCount: number;
  readonly deduplicatedCount: number;
  readonly heldCount: number;
}

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_SIGNAL_ID = /^[A-Za-z0-9._:-]{1,160}$/;
const OPPORTUNITY_KINDS: ReadonlySet<NusaEngineeringOpportunityKind> = new Set([
  "CI_FAILURE_FAMILY",
  "CI_LONG_TAIL",
  "RECOVERY_GAP",
  "ARCHITECTURE_DRIFT",
  "PAPER_EVIDENCE_GAP",
  "UI_FRICTION",
  "DEPENDENCY_BOTTLENECK",
]);
const EVIDENCE_STATES: ReadonlySet<NusaEngineeringEvidenceState> = new Set(["VERIFIED", "UNKNOWN", "INSUFFICIENT"]);
const canonicalTimestamp = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function candidateKey(signal: NusaEngineeringOpportunitySignal): string {
  return `${signal.kind}:${normalize(signal.subject)}`;
}

function validateSignal(signal: NusaEngineeringOpportunitySignal): void {
  if (signal == null || typeof signal !== "object" || Array.isArray(signal)) throw new Error("OPPORTUNITY_SIGNAL_INVALID");
  if (typeof signal.signalId !== "string" || !SAFE_SIGNAL_ID.test(signal.signalId)) throw new Error("OPPORTUNITY_SIGNAL_ID_INVALID");
  if (typeof signal.kind !== "string" || !OPPORTUNITY_KINDS.has(signal.kind as NusaEngineeringOpportunityKind)) throw new Error("OPPORTUNITY_KIND_INVALID");
  if (typeof signal.subject !== "string" || !signal.subject.trim()) throw new Error("OPPORTUNITY_SUBJECT_REQUIRED");
  if (signal.subject.length > 256) throw new Error("OPPORTUNITY_SUBJECT_INVALID");
  if (typeof signal.evidenceState !== "string" || !EVIDENCE_STATES.has(signal.evidenceState as NusaEngineeringEvidenceState)) {
    throw new Error("OPPORTUNITY_EVIDENCE_STATE_INVALID");
  }
  if (!canonicalTimestamp(signal.observedAt)) throw new Error("OPPORTUNITY_OBSERVED_AT_INVALID");
  if (!Number.isSafeInteger(signal.occurrences) || signal.occurrences <= 0) throw new Error("OPPORTUNITY_OCCURRENCES_INVALID");
  if (typeof signal.sourceFingerprint !== "string" || !SHA256.test(signal.sourceFingerprint)) throw new Error("OPPORTUNITY_SOURCE_FINGERPRINT_INVALID");
  if (signal.existingIssueNumber != null && (!Number.isSafeInteger(signal.existingIssueNumber) || signal.existingIssueNumber <= 0)) {
    throw new Error("OPPORTUNITY_EXISTING_ISSUE_INVALID");
  }
  if (signal.existingWorkId != null && (typeof signal.existingWorkId !== "string" || !signal.existingWorkId.trim() || signal.existingWorkId.length > 256)) {
    throw new Error("OPPORTUNITY_EXISTING_WORK_INVALID");
  }
}

/**
 * Deterministically converts repository/product evidence signals into auditable engineering candidates.
 * This function only discovers and deduplicates work. It does not schedule, claim, merge, or mutate the
 * canonical #903 queue. UNKNOWN/INSUFFICIENT evidence remains held instead of being promoted to confidence.
 */
export function discoverNusaEngineeringOpportunities(
  signals: readonly NusaEngineeringOpportunitySignal[],
): NusaEngineeringOpportunityDiscoveryResult {
  if (!Array.isArray(signals)) throw new Error("OPPORTUNITY_SIGNALS_INVALID");
  const ids = new Set<string>();
  const fingerprints = new Map<string, string>();
  for (const signal of signals) {
    validateSignal(signal);
    if (ids.has(signal.signalId)) throw new Error(`OPPORTUNITY_SIGNAL_ID_DUPLICATE:${signal.signalId}`);
    ids.add(signal.signalId);
    const prior = fingerprints.get(signal.sourceFingerprint);
    if (prior && prior !== signal.signalId) throw new Error(`OPPORTUNITY_SOURCE_FINGERPRINT_REUSED:${signal.sourceFingerprint}`);
    fingerprints.set(signal.sourceFingerprint, signal.signalId);
  }

  const groups = new Map<string, NusaEngineeringOpportunitySignal[]>();
  for (const signal of signals) {
    const key = candidateKey(signal);
    const group = groups.get(key) ?? [];
    group.push(signal);
    groups.set(key, group);
  }

  const candidates = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, group]) => {
    const ordered = [...group].sort((a, b) => a.observedAt - b.observedAt || a.signalId.localeCompare(b.signalId));
    const verified = ordered.filter((signal) => signal.evidenceState === "VERIFIED");
    const issueNumbers = [...new Set(ordered.map((signal) => signal.existingIssueNumber).filter((value): value is number => value != null))];
    const workIds = [...new Set(ordered.map((signal) => signal.existingWorkId?.trim()).filter((value): value is string => Boolean(value)))];
    if (issueNumbers.length > 1) throw new Error(`OPPORTUNITY_ISSUE_IDENTITY_CONFLICT:${key}`);
    if (workIds.length > 1) throw new Error(`OPPORTUNITY_WORK_IDENTITY_CONFLICT:${key}`);

    const existingIssueNumber = issueNumbers[0] ?? null;
    const existingWorkId = workIds[0] ?? null;
    const totalOccurrences = ordered.reduce((sum, signal) => sum + signal.occurrences, 0);
    const latestObservedAt = ordered[ordered.length - 1]!.observedAt;
    const evidenceState: NusaEngineeringEvidenceState = verified.length > 0 ? "VERIFIED" : ordered.some((signal) => signal.evidenceState === "UNKNOWN") ? "UNKNOWN" : "INSUFFICIENT";
    const duplicate = existingIssueNumber !== null || existingWorkId !== null;
    const action = duplicate
      ? "DEDUPLICATED" as const
      : evidenceState === "VERIFIED"
        ? "CREATE_CANDIDATE" as const
        : "HOLD_INSUFFICIENT_EVIDENCE" as const;
    const auditReasons = [
      `SIGNALS:${ordered.length}`,
      `OCCURRENCES:${totalOccurrences}`,
      `EVIDENCE:${evidenceState}`,
      duplicate ? "EXISTING_CANONICAL_WORK" : action === "CREATE_CANDIDATE" ? "VERIFIED_NEW_OPPORTUNITY" : "EVIDENCE_NOT_VERIFIED",
    ];

    return freeze({
      candidateId: key,
      kind: ordered[0]!.kind,
      subject: normalize(ordered[0]!.subject),
      signalIds: freeze(ordered.map((signal) => signal.signalId)),
      evidenceState,
      totalOccurrences,
      latestObservedAt,
      existingIssueNumber,
      existingWorkId,
      action,
      auditReasons: freeze(auditReasons),
    });
  });

  return freeze({
    schemaVersion: 1 as const,
    candidates: freeze(candidates),
    discoveredCount: candidates.filter((candidate) => candidate.action === "CREATE_CANDIDATE").length,
    deduplicatedCount: candidates.filter((candidate) => candidate.action === "DEDUPLICATED").length,
    heldCount: candidates.filter((candidate) => candidate.action === "HOLD_INSUFFICIENT_EVIDENCE").length,
  });
}
