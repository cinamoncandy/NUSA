export type NusaEngineeringExecutionOrigin = "AUTO_BACKGROUND" | "USER_TRIGGERED";

export type NusaEngineeringExecutionEvent =
  | "SCHEDULE"
  | "REPOSITORY_DISPATCH"
  | "WORKFLOW_DISPATCH"
  | "OWNER_REQUEST"
  | "PUSH"
  | "PULL_REQUEST";

export interface NusaEngineeringExecutionEvidence {
  readonly schemaVersion: 1;
  readonly executionId: string;
  readonly event: NusaEngineeringExecutionEvent;
  readonly sourceRef: string;
  readonly sourceFingerprint: string;
  readonly observedAt: number;
  readonly workflowRunId: number | null;
  readonly evidenceRefs: readonly string[];
}

export interface NusaEngineeringExecutionOriginProjection {
  readonly schemaVersion: 1;
  readonly status: "VERIFIED" | "UNKNOWN";
  readonly origin: NusaEngineeringExecutionOrigin | null;
  readonly event: NusaEngineeringExecutionEvent | null;
  readonly executionId: string | null;
  readonly observedAt: number | null;
  readonly sourceRef: string | null;
  readonly sourceFingerprint: string | null;
  readonly evidenceRefs: readonly string[];
  readonly reasons: readonly string[];
}

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9._:-]+$/;
const URI_REF = /^[a-z][a-z0-9+.-]*:\/\/[A-Za-z0-9._:/-]+$/;
const GITHUB_EVENTS: ReadonlySet<NusaEngineeringExecutionEvent> = new Set([
  "SCHEDULE",
  "REPOSITORY_DISPATCH",
  "WORKFLOW_DISPATCH",
]);
const KNOWN_EVENTS: ReadonlySet<NusaEngineeringExecutionEvent> = new Set([
  ...GITHUB_EVENTS,
  "OWNER_REQUEST",
  "PUSH",
  "PULL_REQUEST",
]);
const ORIGIN_BY_EVENT: Readonly<Partial<Record<NusaEngineeringExecutionEvent, NusaEngineeringExecutionOrigin>>> = Object.freeze({
  SCHEDULE: "AUTO_BACKGROUND",
  REPOSITORY_DISPATCH: "AUTO_BACKGROUND",
  WORKFLOW_DISPATCH: "USER_TRIGGERED",
  OWNER_REQUEST: "USER_TRIGGERED",
});

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const isSafeSourceRef = (value: string): boolean => /^github:\/\/actions\/run\/[1-9][0-9]*$/.test(value) || /^control:\/\/request\/[A-Za-z0-9._:-]+$/.test(value);

function unknownProjection(
  evidence: Partial<NusaEngineeringExecutionEvidence> | null,
  reasons: readonly string[],
): NusaEngineeringExecutionOriginProjection {
  return freeze({
    schemaVersion: 1,
    status: "UNKNOWN",
    origin: null,
    event: typeof evidence?.event === "string" && KNOWN_EVENTS.has(evidence.event as NusaEngineeringExecutionEvent) ? evidence.event as NusaEngineeringExecutionEvent : null,
    executionId: typeof evidence?.executionId === "string" && SAFE_ID.test(evidence.executionId) ? evidence.executionId : null,
    observedAt: typeof evidence?.observedAt === "number" && Number.isSafeInteger(evidence.observedAt) && evidence.observedAt >= 0 ? evidence.observedAt : null,
    sourceRef: typeof evidence?.sourceRef === "string" && isSafeSourceRef(evidence.sourceRef) ? evidence.sourceRef : null,
    sourceFingerprint: null,
    evidenceRefs: freeze([]),
    reasons: freeze([...new Set(reasons)].sort()),
  });
}

/**
 * Projects an immutable execution receipt into a report-safe origin. Origin is derived from the
 * observed trigger semantics, never accepted as a caller-supplied label. Ambiguous or incomplete
 * receipts remain UNKNOWN so operational reports cannot claim who initiated work without evidence.
 */
export function projectNusaEngineeringExecutionOrigin(
  evidence: NusaEngineeringExecutionEvidence | null,
): NusaEngineeringExecutionOriginProjection {
  if (evidence == null || typeof evidence !== "object") {
    return unknownProjection(null, ["EXECUTION_EVIDENCE_MISSING"]);
  }

  const candidate = evidence as Partial<NusaEngineeringExecutionEvidence>;
  const reasons: string[] = [];
  if (candidate.schemaVersion !== 1) reasons.push("EXECUTION_SCHEMA_INVALID");
  if (typeof candidate.executionId !== "string" || !candidate.executionId.trim() || !SAFE_ID.test(candidate.executionId)) reasons.push("EXECUTION_ID_INVALID");
  if (typeof candidate.event !== "string" || !KNOWN_EVENTS.has(candidate.event as NusaEngineeringExecutionEvent)) reasons.push("EXECUTION_EVENT_UNKNOWN");
  if (!Number.isSafeInteger(candidate.observedAt) || (candidate.observedAt as number) < 0) reasons.push("EXECUTION_OBSERVED_AT_INVALID");
  if (typeof candidate.sourceFingerprint !== "string" || !SHA256.test(candidate.sourceFingerprint)) reasons.push("EXECUTION_SOURCE_FINGERPRINT_INVALID");
  if (!Array.isArray(candidate.evidenceRefs) || candidate.evidenceRefs.length === 0) {
    reasons.push("EXECUTION_EVIDENCE_REFS_MISSING");
  } else {
    const refs = candidate.evidenceRefs as readonly unknown[];
    if (refs.some((ref) => typeof ref !== "string" || !URI_REF.test(ref))) reasons.push("EXECUTION_EVIDENCE_REF_INVALID");
    if (new Set(refs).size !== refs.length) reasons.push("EXECUTION_EVIDENCE_REF_DUPLICATE");
    if (typeof candidate.sourceRef !== "string" || !refs.includes(candidate.sourceRef)) reasons.push("EXECUTION_SOURCE_REF_UNBOUND");
  }

  const event = candidate.event;
  const origin = typeof event === "string" ? ORIGIN_BY_EVENT[event as NusaEngineeringExecutionEvent] : undefined;
  if (origin == null && !reasons.includes("EXECUTION_EVENT_UNKNOWN")) reasons.push("EXECUTION_EVENT_AMBIGUOUS");

  if (typeof event === "string" && GITHUB_EVENTS.has(event as NusaEngineeringExecutionEvent)) {
    if (!Number.isSafeInteger(candidate.workflowRunId) || (candidate.workflowRunId as number) <= 0) reasons.push("EXECUTION_WORKFLOW_RUN_ID_INVALID");
    const expectedSource = `github://actions/run/${candidate.workflowRunId ?? ""}`;
    if (candidate.sourceRef !== expectedSource) reasons.push("EXECUTION_GITHUB_SOURCE_REF_INVALID");
  } else if (event === "OWNER_REQUEST") {
    if (candidate.workflowRunId !== null) reasons.push("EXECUTION_OWNER_REQUEST_RUN_ID_FORBIDDEN");
    const expectedSource = `control://request/${candidate.executionId ?? ""}`;
    if (candidate.sourceRef !== expectedSource) reasons.push("EXECUTION_CONTROL_SOURCE_REF_INVALID");
  } else if (candidate.workflowRunId !== null) {
    reasons.push("EXECUTION_RUN_ID_UNBOUND");
  }

  if (reasons.length > 0 || origin == null) return unknownProjection(candidate, reasons.length > 0 ? reasons : ["EXECUTION_ORIGIN_UNKNOWN"]);

  return freeze({
    schemaVersion: 1,
    status: "VERIFIED",
    origin,
    event: event as NusaEngineeringExecutionEvent,
    executionId: candidate.executionId as string,
    observedAt: candidate.observedAt as number,
    sourceRef: candidate.sourceRef as string,
    sourceFingerprint: candidate.sourceFingerprint as string,
    evidenceRefs: freeze([candidate.sourceRef as string]),
    reasons: freeze([]),
  });
}
