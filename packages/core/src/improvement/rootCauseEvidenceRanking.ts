import { createHash } from "node:crypto";
import type {
  ImprovementDiagnosticEvidence,
  RankedRootCauseEvidence,
  RootCauseEvidenceBundle,
  RootCauseEvidenceFactor,
  RootCauseEvidenceFactorCode,
  RootCauseHypothesis
} from "./improvementTypes";

export interface RootCauseEvidenceRankingOptions {
  readonly maxRankedEvidence?: number;
  readonly maxHypotheses?: number;
}

const DEFAULT_MAX_RANKED_EVIDENCE = 32;
const DEFAULT_MAX_HYPOTHESES = 3;
const MAX_RECENCY_SECONDS = 60;
const MAX_DOWNTIME_SECONDS = 60;
const MAX_RECONNECT_ATTEMPTS = 32;

const isSafeNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const validEvidence = (value: unknown): value is ImprovementDiagnosticEvidence => {
  if (value == null || typeof value !== "object") return false;
  const evidence = value as Partial<ImprovementDiagnosticEvidence>;
  return typeof evidence.id === "string" && evidence.id.length > 0
    && typeof evidence.fingerprint === "string" && evidence.fingerprint.length > 0
    && evidence.type === "MARKET_RECONNECT_INSTABILITY"
    && evidence.source === "MarketConnectionSupervisor"
    && isSafeNonNegativeInteger(evidence.observedAt)
    && (evidence.state === "RECONNECTING" || evidence.state === "FAILED")
    && isSafeNonNegativeInteger(evidence.reconnectAttempt)
    && isSafeNonNegativeInteger(evidence.reconnectAttemptLimit)
    && isSafeNonNegativeInteger(evidence.downtimeMs)
    && (evidence.failureReason === null || evidence.failureReason === "MAX_ATTEMPTS_EXCEEDED" || evidence.failureReason === "MAX_RECONNECT_TIME_EXCEEDED");
};

const validBundle = (bundle: RootCauseEvidenceBundle): boolean => {
  if (bundle == null || typeof bundle !== "object" || typeof bundle.candidateFingerprint !== "string" || bundle.candidateFingerprint.length === 0) return false;
  if (bundle.status !== "CORRELATED" && bundle.status !== "INSUFFICIENT_EVIDENCE" && bundle.status !== "CONTRADICTORY") return false;
  if (!Array.isArray(bundle.evidence) || !bundle.evidence.every(validEvidence) || !Array.isArray(bundle.provenance) || !isSafeNonNegativeInteger(bundle.generatedAt)) return false;
  return bundle.evidence.every((evidence) => evidence.fingerprint === bundle.candidateFingerprint
    && bundle.provenance.some((item) => item.evidenceId === evidence.id && item.observedAt === evidence.observedAt));
};

const validLimit = (value: number, max: number): boolean => Number.isSafeInteger(value) && value >= 1 && value <= max;

function factor(code: RootCauseEvidenceFactorCode, value: number, points: number, reason: string): RootCauseEvidenceFactor {
  return Object.freeze({ code, value, points, reason });
}

function rankOne(evidence: ImprovementDiagnosticEvidence, generatedAt: number): RankedRootCauseEvidence {
  const ageSeconds = Math.min(MAX_RECENCY_SECONDS, Math.floor(Math.max(0, generatedAt - evidence.observedAt) / 1_000));
  const factors = Object.freeze([
    factor("STATE_FAILED", evidence.state === "FAILED" ? 1 : 0, evidence.state === "FAILED" ? 4 : 0, evidence.state === "FAILED" ? "terminal failure state observed" : "non-terminal reconnecting state"),
    factor("FAILURE_REASON_PRESENT", evidence.failureReason == null ? 0 : 1, evidence.failureReason == null ? 0 : 3, evidence.failureReason == null ? "failure reason absent" : "failure reason recorded"),
    factor("DOWNTIME_BUCKET", Math.min(MAX_DOWNTIME_SECONDS, Math.floor(evidence.downtimeMs / 1_000)), Math.min(MAX_DOWNTIME_SECONDS, Math.floor(evidence.downtimeMs / 1_000)), "downtime duration bucket"),
    factor("RECONNECT_ATTEMPT_BUCKET", Math.min(MAX_RECONNECT_ATTEMPTS, evidence.reconnectAttempt), Math.min(MAX_RECONNECT_ATTEMPTS, evidence.reconnectAttempt), "reconnect attempt bucket"),
    factor("RECENCY_BUCKET", MAX_RECENCY_SECONDS - ageSeconds, MAX_RECENCY_SECONDS - ageSeconds, "recency relative to bundle timestamp")
  ]);
  const reasonCodes = Object.freeze(factors.filter((item) => item.points > 0).map((item) => item.code));
  return Object.freeze({ evidenceId: evidence.id, rank: 0, score: factors.reduce((sum, item) => sum + item.points, 0), factors, reasonCodes });
}

/**
 * Ranks verified evidence using only observable values. The score is an ordering
 * aid, never a probability or a causal confidence value.
 */
export function rankRootCauseEvidence(
  bundle: RootCauseEvidenceBundle,
  options: RootCauseEvidenceRankingOptions = {}
): readonly RankedRootCauseEvidence[] {
  const maxRankedEvidence = options.maxRankedEvidence ?? DEFAULT_MAX_RANKED_EVIDENCE;
  if (!validBundle(bundle) || bundle.status !== "CORRELATED" || !validLimit(maxRankedEvidence, DEFAULT_MAX_RANKED_EVIDENCE)) return Object.freeze([]);
  const byId = new Map<string, ImprovementDiagnosticEvidence>();
  for (const evidence of bundle.evidence) {
    if (!byId.has(evidence.id)) byId.set(evidence.id, evidence);
  }
  return Object.freeze([...byId.values()]
    .map((evidence) => rankOne(evidence, bundle.generatedAt))
    .sort((left, right) => {
      const leftEvidence = byId.get(left.evidenceId)!;
      const rightEvidence = byId.get(right.evidenceId)!;
      return right.score - left.score || rightEvidence.observedAt - leftEvidence.observedAt || left.evidenceId.localeCompare(right.evidenceId);
    })
    .slice(0, maxRankedEvidence)
    .map((item, index) => Object.freeze({ ...item, rank: index + 1 })));
}

function hypothesisId(candidateFingerprint: string, group: string, evidenceIds: readonly string[]): string {
  const digest = createHash("sha256")
    .update(JSON.stringify({ candidateFingerprint, group, evidenceIds }), "utf8")
    .digest("hex");
  return `hypothesis:${digest}`;
}

function blockedHypothesis(bundle: RootCauseEvidenceBundle | null | undefined, status: "BLOCKED" | "UNRESOLVED", code: string): RootCauseHypothesis {
  const candidateFingerprint = bundle?.candidateFingerprint || "unknown";
  const statement = status === "BLOCKED"
    ? "Contradictory or unverifiable evidence prevents hypothesis preparation."
    : "Evidence is insufficient to prepare a root-cause hypothesis.";
  return Object.freeze({
    id: hypothesisId(candidateFingerprint, code, []),
    candidateFingerprint,
    status,
    statement,
    evidenceIds: Object.freeze([]),
    rankingReasonCodes: Object.freeze([]),
    unresolvedCodes: Object.freeze([code]),
    generatedAt: bundle?.generatedAt ?? 0
  });
}

/** Prepares bounded observations, not causal diagnoses or executable actions. */
export function prepareRootCauseHypotheses(
  bundle: RootCauseEvidenceBundle,
  options: RootCauseEvidenceRankingOptions = {}
): readonly RootCauseHypothesis[] {
  if (!validBundle(bundle)) return Object.freeze([blockedHypothesis(bundle, "BLOCKED", "BUNDLE_INVALID")]);
  if (bundle.status === "CONTRADICTORY") return Object.freeze([blockedHypothesis(bundle, "BLOCKED", "CONTRADICTORY_EVIDENCE")]);
  if (bundle.status === "INSUFFICIENT_EVIDENCE") return Object.freeze([blockedHypothesis(bundle, "UNRESOLVED", "INSUFFICIENT_EVIDENCE")]);
  const maxHypotheses = options.maxHypotheses ?? DEFAULT_MAX_HYPOTHESES;
  if (!validLimit(maxHypotheses, DEFAULT_MAX_HYPOTHESES)) return Object.freeze([blockedHypothesis(bundle, "BLOCKED", "MAX_HYPOTHESES_INVALID")]);
  const ranked = rankRootCauseEvidence(bundle, options);
  if (ranked.length === 0) return Object.freeze([blockedHypothesis(bundle, "UNRESOLVED", "NO_RANKED_EVIDENCE")]);
  const evidenceById = new Map(bundle.evidence.map((evidence) => [evidence.id, evidence] as const));
  const groups = new Map<string, RankedRootCauseEvidence[]>();
  for (const item of ranked) {
    const evidence = evidenceById.get(item.evidenceId)!;
    const group = evidence.failureReason ?? `STATE_${evidence.state}`;
    const values = groups.get(group) ?? [];
    values.push(item);
    groups.set(group, values);
  }
  const selected = [...groups.entries()].slice(0, maxHypotheses);
  const bounded = selected.length < groups.size;
  return Object.freeze(selected.map(([group, items], index) => {
    const evidenceIds = Object.freeze(items.map((item) => item.evidenceId));
    const rankingReasonCodes = Object.freeze([...new Set(items.flatMap((item) => item.reasonCodes))].sort());
    const unresolvedCodes = bounded && index === 0 ? ["CAUSALITY_UNRESOLVED", "HYPOTHESIS_FANOUT_BOUNDED"] : ["CAUSALITY_UNRESOLVED"];
    return Object.freeze({
      id: hypothesisId(bundle.candidateFingerprint, group, evidenceIds),
      candidateFingerprint: bundle.candidateFingerprint,
      status: "EVIDENCE_BOUND" as const,
      statement: `Observed diagnostic group '${group}' across ${items.length} evidence item(s); causal attribution remains unresolved.`,
      evidenceIds,
      rankingReasonCodes,
      unresolvedCodes: Object.freeze(unresolvedCodes),
      generatedAt: bundle.generatedAt
    });
  }));
}
