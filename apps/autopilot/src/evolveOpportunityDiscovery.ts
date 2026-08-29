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

/**
 * Converts bounded, externally observed signals into EVOLVE opportunities.
 * Discovery has ZERO execution authority: it cannot enqueue, execute, promote,
 * deploy, mutate production, or bypass the existing selector/lifecycle gates.
 */
export function discoverEvolutionOpportunities(
  signals: readonly EvolutionDiscoverySignal[],
): EvolutionDiscoveryResult {
  const opportunities: EvolutionOpportunity[] = [];
  const rejectedSignalIds: string[] = [];
  const seen = new Set<string>();

  for (const signal of signals.slice(0, MAX_SIGNALS)) {
    if (seen.has(signal.id)) continue;
    seen.add(signal.id);

    try {
      if (!Number.isFinite(Date.parse(signal.observedAt))) throw new Error("DISCOVERY_TIMESTAMP_INVALID");
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
      rejectedSignalIds.push(signal.id);
    }
  }

  return Object.freeze({
    opportunities: Object.freeze(opportunities),
    rejectedSignalIds: Object.freeze(rejectedSignalIds),
    authority: AUTHORITY,
  });
}
