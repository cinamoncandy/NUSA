import { validateImprovementObserverPolicy } from "./problemDetector";
import type { ImprovementCandidate, ImprovementObserverPolicy, ImprovementSeverity, ImprovementSignal } from "./improvementTypes";

interface Aggregate {
  readonly fingerprint: string;
  readonly type: ImprovementSignal["type"];
  readonly source: ImprovementSignal["source"];
  severity: ImprovementSeverity;
  score: number;
  occurrences: number;
  firstSeenAt: number;
  lastSeenAt: number;
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
      lastSeenAt: signal.observedAt
    };
    aggregate.occurrences += 1;
    aggregate.lastSeenAt = Math.max(aggregate.lastSeenAt, signal.observedAt);
    if (SEVERITY_RANK[signal.severity] > SEVERITY_RANK[aggregate.severity]) aggregate.severity = signal.severity;
    aggregate.score = SEVERITY_RANK[aggregate.severity] * 1_000 + Math.min(aggregate.occurrences, 100);
    this.aggregatesByFingerprint.set(signal.fingerprint, aggregate);
    this.evictIfNeeded();
    if (!this.aggregatesByFingerprint.has(signal.fingerprint) || aggregate.occurrences < this.policy.minOccurrences) return null;
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
      title: "Market reconnect instability detected",
      status: "PENDING_REVIEW" as const
    });
  }

  size(): number { return this.aggregatesByFingerprint.size; }

  candidates(): readonly ImprovementCandidate[] {
    return Object.freeze([...this.aggregatesByFingerprint.values()]
      .filter((aggregate) => aggregate.occurrences >= this.policy.minOccurrences)
      .sort((left, right) => right.score - left.score || left.lastSeenAt - right.lastSeenAt || left.fingerprint.localeCompare(right.fingerprint))
      .map((aggregate) => Object.freeze({
        id: `candidate:${aggregate.fingerprint}`,
        fingerprint: aggregate.fingerprint,
        type: aggregate.type,
        source: aggregate.source,
        severity: aggregate.severity,
        score: aggregate.score,
        occurrences: aggregate.occurrences,
        firstSeenAt: aggregate.firstSeenAt,
        lastSeenAt: aggregate.lastSeenAt,
        title: "Market reconnect instability detected",
        status: "PENDING_REVIEW" as const
      })));
  }

  private evictIfNeeded(): void {
    while (this.aggregatesByFingerprint.size > this.policy.maxCandidates) {
      const victim = [...this.aggregatesByFingerprint.values()].sort((left, right) => left.score - right.score || right.lastSeenAt - left.lastSeenAt || right.fingerprint.localeCompare(left.fingerprint))[0];
      if (victim === undefined) return;
      this.aggregatesByFingerprint.delete(victim.fingerprint);
    }
  }
}
