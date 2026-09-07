import { validateEvolutionOpportunity, type EvolutionOpportunity } from "./evolveOpportunity";

export interface EvolutionDiscoverySignal {
  readonly id: string;
  readonly source: string;
  readonly reference: string;
  readonly problem: string;
  readonly observedAt: string;
  readonly evidenceQuality: number;
  readonly impact: number;
  readonly confidence: number;
  readonly risk: number;
  readonly reversibility: number;
}

export interface EvolutionDiscoveryResult {
  readonly opportunities: readonly EvolutionOpportunity[];
  readonly rejectedSignalIds: readonly string[];
  readonly authority: {
    readonly liveAuthority: "NONE";
    readonly productionMutationAllowed: false;
    readonly aiAuthority: "ZERO_AUTHORITY";
  };
}

const AUTHORITY = Object.freeze({
  liveAuthority: "NONE" as const,
  productionMutationAllowed: false as const,
  aiAuthority: "ZERO_AUTHORITY" as const,
});

const MAX_SIGNALS = 64;
const MIN_EVIDENCE_QUALITY = 0.5;
const MAX_RISK = 0.8;
const MAX_SIGNAL_AGE_MS = 60 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rejectionId(value: unknown, index: number): string {
  return isRecord(value) && typeof value.id === "string" ? value.id : `invalid:${index}`;
}

function assertScore(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("DISCOVERY_SCORE_INVALID");
  }
}

/**
 * Converts bounded, externally observed signals into EVOLVE opportunities.
 * Discovery has ZERO execution authority: it cannot enqueue, execute, promote,
 * deploy, mutate production, or bypass the existing selector/lifecycle gates.
 */
export function discoverEvolutionOpportunities(
  signals: readonly EvolutionDiscoverySignal[],
  now: Date = new Date(),
): EvolutionDiscoveryResult {
  if (!Array.isArray(signals)) throw new Error("DISCOVERY_SIGNALS_INVALID");
  if (!(now instanceof Date)) throw new Error("DISCOVERY_CLOCK_INVALID");
  const opportunities: EvolutionOpportunity[] = [];
  const rejectedSignalIds: string[] = [];
  const seen = new Set<string>();
  const nowMs = now.getTime();

  if (!Number.isFinite(nowMs)) {
    throw new Error("DISCOVERY_CLOCK_INVALID");
  }

  for (const [index, rawSignal] of signals.slice(0, MAX_SIGNALS).entries()) {
    const id = rejectionId(rawSignal, index);

    try {
      if (!isRecord(rawSignal)) throw new Error("DISCOVERY_SIGNAL_INVALID");
      if (typeof rawSignal.id !== "string") throw new Error("DISCOVERY_TEXT_INVALID");
      if (seen.has(rawSignal.id)) continue;
      seen.add(rawSignal.id);
      if (typeof rawSignal.source !== "string" || typeof rawSignal.reference !== "string" || typeof rawSignal.problem !== "string" || typeof rawSignal.observedAt !== "string") {
        throw new Error("DISCOVERY_TEXT_INVALID");
      }
      const signal = rawSignal as unknown as EvolutionDiscoverySignal;
      const observedAtMs = Date.parse(signal.observedAt);
      if (!Number.isFinite(observedAtMs)) throw new Error("DISCOVERY_TIMESTAMP_INVALID");
      if (nowMs - observedAtMs > MAX_SIGNAL_AGE_MS) throw new Error("DISCOVERY_EVIDENCE_STALE");
      if (observedAtMs - nowMs > MAX_FUTURE_SKEW_MS) throw new Error("DISCOVERY_TIMESTAMP_IN_FUTURE");
      if (!signal.id.trim() || !signal.source.trim() || !signal.reference.trim() || !signal.problem.trim()) {
        throw new Error("DISCOVERY_TEXT_INVALID");
      }

      assertScore(signal.evidenceQuality);
      assertScore(signal.impact);
      assertScore(signal.confidence);
      assertScore(signal.risk);
      assertScore(signal.reversibility);

      if (signal.evidenceQuality < MIN_EVIDENCE_QUALITY) throw new Error("DISCOVERY_EVIDENCE_INSUFFICIENT");
      if (signal.risk > MAX_RISK) throw new Error("DISCOVERY_RISK_TOO_HIGH");

      opportunities.push(validateEvolutionOpportunity({
        id: `discovery:${signal.id}`,
        source: signal.source,
        problem: signal.problem,
        evidence: [{
          source: signal.source,
          reference: signal.reference,
          quality: signal.evidenceQuality,
        }],
        impact: signal.impact,
        confidence: signal.confidence,
        risk: signal.risk,
        reversibility: signal.reversibility,
        status: "DISCOVERED",
        createdAt: signal.observedAt,
      }));
    } catch {
      rejectedSignalIds.push(id);
    }
  }

  return Object.freeze({
    opportunities: Object.freeze(opportunities),
    rejectedSignalIds: Object.freeze(rejectedSignalIds),
    authority: AUTHORITY,
  });
}
