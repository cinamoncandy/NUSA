import { validateImprovementObserverPolicy } from "./problemDetector";
import type { ImprovementCandidate, ImprovementCandidateHistory, ImprovementDiagnosticEvidence, ImprovementObserverPolicy, ImprovementRecurrence, ImprovementSeverity, ImprovementSignal } from "./improvementTypes";

interface Aggregate {
  readonly fingerprint: string;
  readonly type: ImprovementSignal["type"];
  readonly source: ImprovementSignal["source"];
  severity: ImprovementSeverity;
  score: number;
  occurrences: number;
  firstSeenAt: number;
  lastSeenAt: number;
  occurrenceTimestamps: number[];
  evidence: ImprovementDiagnosticEvidence[];
}

const SEVERITY_RANK: Record<ImprovementSeverity, number> = { INFO: 1, LOW: 2, MEDIUM: 3, HIGH: 4, CRITICAL: 5 };

export class ImprovementBacklog {
  private readonly aggregatesByFingerprint = new Map<string, Aggregate>();

  constructor(private readonly policy: ImprovementObserverPolicy) {
    if (validateImprovementObserverPolicy(policy).length > 0) throw new Error("invalid improvement backlog policy");
  }

  record(signal: ImprovementSignal): ImprovementCandidate | null {
    const existing = this.aggregatesByFingerprint.get(signal.fingerprint);
    const aggregate: Aggregate = existing ?? {
      fingerprint: signal.fingerprint,
      type: signal.type,
      source: signal.source,
      severity: signal.severity,
      score: 0,
      occurrences: 0,
      firstSeenAt: signal.observedAt,
      lastSeenAt: signal.observedAt,
      occurrenceTimestamps: [],
      evidence: []
    };
    const evidence: ImprovementDiagnosticEvidence = Object.freeze({ id: signal.id, fingerprint: signal.fingerprint, type: signal.type, source: signal.source, observedAt: signal.observedAt, ...signal.evidence });
    if (aggregate.occurrenceTimestamps.includes(signal.observedAt)) {
      if (!aggregate.evidence.some((item) => item.id === evidence.id)) aggregate.evidence.push(evidence);
      return this.toCandidate(aggregate);
    }
    aggregate.occurrences += 1;
    aggregate.occurrenceTimestamps.push(signal.observedAt);
    aggregate.occurrenceTimestamps.sort((left, right) => left - right);
    aggregate.evidence.push(evidence);
    aggregate.evidence.sort((left, right) => left.observedAt - right.observedAt || left.id.localeCompare(right.id));
    aggregate.lastSeenAt = Math.max(aggregate.lastSeenAt, signal.observedAt);
    if (SEVERITY_RANK[signal.severity] > SEVERITY_RANK[aggregate.severity]) aggregate.severity = signal.severity;
    aggregate.score = SEVERITY_RANK[aggregate.severity] * 1_000 + Math.min(aggregate.occurrences, 100);
    this.aggregatesByFingerprint.set(signal.fingerprint, aggregate);
    this.evictIfNeeded();
    if (!this.aggregatesByFingerprint.has(signal.fingerprint) || aggregate.occurrences < this.policy.minOccurrences) return null;
    return this.toCandidate(aggregate);
  }

  restore(history: ImprovementCandidateHistory): void {
    if (!Number.isSafeInteger(history.occurrences) || history.occurrences < 1 || history.occurrenceTimestamps.length !== history.occurrences) throw new Error("invalid improvement history");
    if (history.occurrenceTimestamps.some((value, index) => !Number.isSafeInteger(value) || value < 0 || (index > 0 && value <= history.occurrenceTimestamps[index - 1]!))) throw new Error("invalid improvement history timestamps");
    if (history.firstSeenAt !== history.occurrenceTimestamps[0] || history.lastSeenAt !== history.occurrenceTimestamps[history.occurrenceTimestamps.length - 1] || history.recurrence !== (history.occurrences > 1 ? "RECURRING" : "NEW")) throw new Error("invalid improvement history chronology");
    if (history.status !== (history.occurrences >= this.policy.minOccurrences ? "PENDING_REVIEW" : "OBSERVED")) throw new Error("invalid improvement history status");
    const aggregate: Aggregate = {
      fingerprint: history.fingerprint,
      type: history.type,
      source: history.source,
      severity: history.severity,
      score: history.score,
      occurrences: history.occurrences,
      firstSeenAt: history.firstSeenAt,
      lastSeenAt: history.lastSeenAt,
      occurrenceTimestamps: [...history.occurrenceTimestamps],
      evidence: [...(history.evidence ?? [])]
    };
    this.aggregatesByFingerprint.set(history.fingerprint, aggregate);
    this.evictIfNeeded();
  }

  history(fingerprint: string): ImprovementCandidateHistory | undefined {
    const aggregate = this.aggregatesByFingerprint.get(fingerprint);
    return aggregate == null ? undefined : this.toHistory(aggregate);
  }

  histories(): readonly ImprovementCandidateHistory[] {
    return Object.freeze([...this.aggregatesByFingerprint.values()]
      .sort((left, right) => right.score - left.score || left.lastSeenAt - right.lastSeenAt || left.fingerprint.localeCompare(right.fingerprint))
      .map((aggregate) => this.toHistory(aggregate)));
  }

  private toHistory(aggregate: Aggregate): ImprovementCandidateHistory {
    const recurrence: ImprovementRecurrence = aggregate.occurrences > 1 ? "RECURRING" : "NEW";
    return Object.freeze({
      id: `candidate:${aggregate.fingerprint}`,
      fingerprint: aggregate.fingerprint,
      type: aggregate.type,
      source: aggregate.source,
      severity: aggregate.severity,
      score: aggregate.score,
      occurrences: aggregate.occurrences,
      firstSeenAt: aggregate.firstSeenAt,
      lastSeenAt: aggregate.lastSeenAt,
      occurrenceTimestamps: Object.freeze([...aggregate.occurrenceTimestamps]),
      evidence: Object.freeze([...aggregate.evidence]),
      recurrence,
      title: "Market reconnect instability detected",
      status: aggregate.occurrences >= this.policy.minOccurrences ? "PENDING_REVIEW" as const : "OBSERVED" as const
    });
  }

  size(): number { return this.aggregatesByFingerprint.size; }

  candidates(): readonly ImprovementCandidate[] {
    return Object.freeze([...this.aggregatesByFingerprint.values()]
      .filter((aggregate) => aggregate.occurrences >= this.policy.minOccurrences)
      .sort((left, right) => right.score - left.score || left.lastSeenAt - right.lastSeenAt || left.fingerprint.localeCompare(right.fingerprint))
      .map((aggregate) => this.toCandidate(aggregate)!));
  }

  private toCandidate(aggregate: Aggregate): ImprovementCandidate | null {
    if (aggregate.occurrences < this.policy.minOccurrences) return null;
    const history = this.toHistory(aggregate);
    return Object.freeze({ ...history, status: "PENDING_REVIEW" as const });
  }

  private evictIfNeeded(): void {
    while (this.aggregatesByFingerprint.size > this.policy.maxCandidates) {
      const victim = [...this.aggregatesByFingerprint.values()].sort((left, right) => left.score - right.score || right.lastSeenAt - left.lastSeenAt || right.fingerprint.localeCompare(left.fingerprint))[0];
      if (victim === undefined) return;
      this.aggregatesByFingerprint.delete(victim.fingerprint);
    }
  }
}
