import type {
  ImprovementCandidate,
  ImprovementCandidateHistory,
  ImprovementDiagnosticEvidence,
  RootCauseEvidenceBundle
} from "./improvementTypes";
import { prepareRootCauseHypotheses, rankRootCauseEvidence } from "./rootCauseEvidenceRanking";
import { buildRemediationProposals } from "./remediationProposal";

export interface RootCauseEvidenceCorrelationOptions {
  readonly maxEvidence?: number;
}

const DEFAULT_MAX_EVIDENCE = 32;
const STATES = new Set(["RECONNECTING", "FAILED"]);
const REASONS = new Set(["MAX_ATTEMPTS_EXCEEDED", "MAX_RECONNECT_TIME_EXCEEDED"]);

const isSafeNonNegativeInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function isEvidence(value: unknown): value is ImprovementDiagnosticEvidence {
  if (value === null || typeof value !== "object") return false;
  const evidence = value as Partial<ImprovementDiagnosticEvidence>;
  return typeof evidence.id === "string" && evidence.id.length > 0
    && typeof evidence.fingerprint === "string" && evidence.fingerprint.length > 0
    && evidence.type === "MARKET_RECONNECT_INSTABILITY"
    && evidence.source === "MarketConnectionSupervisor"
    && isSafeNonNegativeInteger(evidence.observedAt)
    && typeof evidence.state === "string" && STATES.has(evidence.state)
    && isSafeNonNegativeInteger(evidence.reconnectAttempt)
    && isSafeNonNegativeInteger(evidence.reconnectAttemptLimit)
    && isSafeNonNegativeInteger(evidence.downtimeMs)
    && (evidence.failureReason === null || (typeof evidence.failureReason === "string" && REASONS.has(evidence.failureReason)));
}

function isCandidate(value: unknown): value is ImprovementCandidate | ImprovementCandidateHistory {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<ImprovementCandidate>;
  return typeof candidate.id === "string" && candidate.id === `candidate:${candidate.fingerprint}`
    && typeof candidate.fingerprint === "string" && candidate.fingerprint.length > 0
    && candidate.type === "MARKET_RECONNECT_INSTABILITY"
    && candidate.source === "MarketConnectionSupervisor"
    && isSafeNonNegativeInteger(candidate.occurrences) && candidate.occurrences > 0
    && isSafeNonNegativeInteger(candidate.firstSeenAt)
    && isSafeNonNegativeInteger(candidate.lastSeenAt)
    && Array.isArray(candidate.occurrenceTimestamps)
    && candidate.occurrenceTimestamps.length === candidate.occurrences
    && candidate.occurrenceTimestamps.every(isSafeNonNegativeInteger)
    && candidate.firstSeenAt === candidate.occurrenceTimestamps[0]
    && candidate.lastSeenAt === candidate.occurrenceTimestamps[candidate.occurrenceTimestamps.length - 1]
    && Array.isArray(candidate.evidence);
}

function invalidBundle(): RootCauseEvidenceBundle {
  return Object.freeze({
    id: "root-cause:invalid",
    candidateId: "unknown",
    candidateFingerprint: "",
    status: "CONTRADICTORY" as const,
    confidence: null,
    evidence: Object.freeze([]),
    provenance: Object.freeze([]),
    correlationReasons: Object.freeze([]),
    contradictionCodes: Object.freeze(["CANDIDATE_INVALID"]),
    rankedEvidence: Object.freeze([]),
    hypotheses: Object.freeze([]),
    remediationProposals: Object.freeze([]),
    generatedAt: 0
  });
}

function evidenceKey(evidence: ImprovementDiagnosticEvidence): string {
  return `${evidence.id}|${evidence.observedAt}`;
}

/**
 * Correlates only persisted, observable diagnostics. It never names or infers a root cause;
 * the bundle is evidence for a later human review and remains display-only.
 */
export function correlateRootCauseEvidence(
  candidateInput: ImprovementCandidate | ImprovementCandidateHistory,
  additionalEvidence: readonly ImprovementDiagnosticEvidence[] = [],
  options: RootCauseEvidenceCorrelationOptions = {}
): RootCauseEvidenceBundle {
  if (!isCandidate(candidateInput)) return invalidBundle();
  const maxEvidence = options.maxEvidence ?? DEFAULT_MAX_EVIDENCE;
  if (!Number.isSafeInteger(maxEvidence) || maxEvidence < 1) {
    return Object.freeze({
      ...invalidBundle(),
      id: `root-cause:${candidateInput.fingerprint}`,
      candidateId: candidateInput.id,
      candidateFingerprint: candidateInput.fingerprint,
      generatedAt: candidateInput.lastSeenAt,
      contradictionCodes: Object.freeze(["MAX_EVIDENCE_INVALID"])
    });
  }

  const contradictionCodes = new Set<string>();
  const byKey = new Map<string, ImprovementDiagnosticEvidence>();
  const sources = [...(candidateInput.evidence ?? []), ...additionalEvidence];
  for (const raw of sources) {
    if (!isEvidence(raw)) {
      contradictionCodes.add("EVIDENCE_MALFORMED");
      continue;
    }
    const key = evidenceKey(raw);
    const existing = byKey.get(key);
    if (existing !== undefined) {
      if (JSON.stringify(existing) !== JSON.stringify(raw)) contradictionCodes.add("DUPLICATE_EVIDENCE_CONFLICT");
      continue;
    }
    byKey.set(key, Object.freeze({ ...raw }));
  }

  const ordered = [...byKey.values()].sort((left, right) => left.observedAt - right.observedAt || left.id.localeCompare(right.id));
  const relevant: ImprovementDiagnosticEvidence[] = [];
  for (const evidence of ordered) {
    if (evidence.fingerprint !== candidateInput.fingerprint) { contradictionCodes.add("EVIDENCE_FINGERPRINT_MISMATCH"); continue; }
    if (evidence.type !== candidateInput.type) { contradictionCodes.add("EVIDENCE_TYPE_MISMATCH"); continue; }
    if (evidence.source !== candidateInput.source) { contradictionCodes.add("EVIDENCE_SOURCE_MISMATCH"); continue; }
    if (!candidateInput.occurrenceTimestamps.includes(evidence.observedAt)) { contradictionCodes.add("EVIDENCE_TIMESTAMP_NOT_IN_CANDIDATE"); continue; }
    relevant.push(evidence);
  }

  const bounded = relevant.slice(0, maxEvidence);
  if (relevant.length > bounded.length) contradictionCodes.add("EVIDENCE_FANOUT_BOUNDED");
  const validEvidence = Object.freeze(bounded);
  const evidenceTimestamps = new Set(validEvidence.map((evidence) => evidence.observedAt));
  if (validEvidence.length < candidateInput.occurrences) contradictionCodes.add("EVIDENCE_MISSING_FOR_OCCURRENCE");
  if (evidenceTimestamps.size !== validEvidence.length) contradictionCodes.add("EVIDENCE_TIMESTAMP_DUPLICATE");

  const contradictions = Object.freeze([...contradictionCodes].sort());
  const hasContradiction = contradictions.some((code) => code !== "EVIDENCE_FANOUT_BOUNDED" && code !== "EVIDENCE_MISSING_FOR_OCCURRENCE");
  const status = hasContradiction
    ? "CONTRADICTORY"
    : validEvidence.length === candidateInput.occurrences
      ? "CORRELATED"
      : "INSUFFICIENT_EVIDENCE";
  const confidence = status === "CONTRADICTORY" || validEvidence.length === 0
    ? null
    : Number((validEvidence.length / candidateInput.occurrences).toFixed(6));
  const reasons = new Set<string>([
    "FINGERPRINT_MATCH",
    "SOURCE_MATCH",
    "TYPE_MATCH",
    ...(candidateInput.occurrences > 1 ? ["RECURRENCE_CONFIRMED"] : []),
    ...(status === "CORRELATED" ? ["EVIDENCE_TIMESTAMP_MATCH"] : []),
    ...(contradictions.includes("EVIDENCE_FANOUT_BOUNDED") ? ["EVIDENCE_FANOUT_BOUNDED"] : []),
    ...(contradictions.includes("EVIDENCE_MISSING_FOR_OCCURRENCE") ? ["EVIDENCE_INCOMPLETE"] : [])
  ]);
  const provenance = Object.freeze(validEvidence.map((evidence) => Object.freeze({ evidenceId: evidence.id, source: evidence.source, observedAt: evidence.observedAt })));
  const baseBundle: RootCauseEvidenceBundle = Object.freeze({
    id: `root-cause:${candidateInput.fingerprint}`,
    candidateId: candidateInput.id,
    candidateFingerprint: candidateInput.fingerprint,
    status,
    confidence,
    evidence: validEvidence,
    provenance,
    correlationReasons: Object.freeze([...reasons].sort()),
    contradictionCodes: contradictions,
    rankedEvidence: Object.freeze([]),
    hypotheses: Object.freeze([]),
    remediationProposals: Object.freeze([]),
    generatedAt: candidateInput.lastSeenAt
  });
  const rankedEvidence = rankRootCauseEvidence(baseBundle);
  const rankedBundle: RootCauseEvidenceBundle = Object.freeze({
    ...baseBundle,
    rankedEvidence,
    hypotheses: prepareRootCauseHypotheses(baseBundle)
  });
  return Object.freeze({
    ...rankedBundle,
    remediationProposals: buildRemediationProposals(rankedBundle)
  });
}
