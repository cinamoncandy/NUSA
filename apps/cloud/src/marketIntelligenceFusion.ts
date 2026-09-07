import type { CioSignal, SignalSource } from "./cioDecisionEngine";

export interface IntelligenceObservation {
  readonly id: string;
  readonly source: SignalSource;
  /** Optional canonical market identity for market-scoped observations. */
  readonly market?: string;
  readonly sentiment: number;
  /** Original exchange return, retained as evidence beside the normalized score. */
  readonly rawChangeRate?: number;
  /** Accepted public-market price used by a bound PAPER strategy evaluator. */
  readonly price?: number;
  /** Optional deterministic normalization identity for replay/audit. */
  readonly normalizationPolicyId?: string;
  readonly normalizationPolicyFingerprint?: string;
  readonly confidence: number;
  readonly observedAt: number;
  readonly expiresAt: number;
  readonly summary: string;
}

export interface FusedIntelligence {
  readonly signals: readonly CioSignal[];
  readonly staleSources: readonly SignalSource[];
  readonly generatedAt: number;
}

const assertUnit = (value: number, field: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be between 0 and 1`);
};

const assertSentiment = (value: number): void => {
  if (!Number.isFinite(value) || value < -1 || value > 1) throw new Error("observation.sentiment must be between -1 and 1");
};

const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

export function fuseMarketIntelligence(now: number, observations: readonly IntelligenceObservation[]): FusedIntelligence {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("now must be a non-negative safe integer");
  const ids = new Set<string>();
  const groups = new Map<SignalSource, IntelligenceObservation[]>();
  const stale = new Set<SignalSource>();

  for (const observation of observations) {
    if (!observation.id.trim()) throw new Error("observation.id is required");
    if (ids.has(observation.id)) throw new Error(`duplicate observation id: ${observation.id}`);
    ids.add(observation.id);
    if (observation.market !== undefined && !/^KRW-[A-Z0-9-]+$/.test(observation.market.trim().toUpperCase())) {
      throw new Error("observation.market is invalid");
    }
    if (observation.rawChangeRate !== undefined && !Number.isFinite(observation.rawChangeRate)) {
      throw new Error("observation.rawChangeRate must be finite");
    }
    const hasPolicyId = observation.normalizationPolicyId !== undefined;
    const hasPolicyFingerprint = observation.normalizationPolicyFingerprint !== undefined;
    if (hasPolicyId !== hasPolicyFingerprint) throw new Error("observation normalization policy identity is incomplete");
    if (hasPolicyId && !observation.normalizationPolicyId!.trim()) throw new Error("observation normalization policy id is invalid");
    if (hasPolicyFingerprint && !/^[a-f0-9]{64}$/.test(observation.normalizationPolicyFingerprint!)) {
      throw new Error("observation normalization policy fingerprint is invalid");
    }
    assertSentiment(observation.sentiment);
    assertUnit(observation.confidence, "observation.confidence");
    if (!Number.isSafeInteger(observation.observedAt) || observation.observedAt < 0 || observation.observedAt > now) {
      throw new Error("observation.observedAt is invalid");
    }
    if (!Number.isSafeInteger(observation.expiresAt) || observation.expiresAt < observation.observedAt) {
      throw new Error("observation.expiresAt is invalid");
    }
    if (!observation.summary.trim()) throw new Error("observation.summary is required");
    if (observation.expiresAt < now) {
      stale.add(observation.source);
      continue;
    }
    const group = groups.get(observation.source) ?? [];
    group.push(observation);
    groups.set(observation.source, group);
  }

  const signals: CioSignal[] = [];
  for (const source of [...groups.keys()].sort()) {
    const group = groups.get(source)!;
    let weighted = 0;
    let totalConfidence = 0;
    for (const observation of group) {
      weighted += observation.sentiment * observation.confidence;
      totalConfidence += observation.confidence;
    }
    const confidence = round4(Math.min(1, totalConfidence / group.length));
    const score = round4(weighted / Math.max(totalConfidence, Number.EPSILON));
    const summaries = group
      .slice()
      .sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id))
      .slice(0, 3)
      .map((item) => item.summary.trim());
    signals.push(Object.freeze({
      source,
      score,
      confidence,
      observedAt: Math.max(...group.map((item) => item.observedAt)),
      reason: summaries.join("; ")
    }));
  }

  return Object.freeze({
    signals: Object.freeze(signals),
    staleSources: Object.freeze([...stale].sort()),
    generatedAt: now
  });
}
