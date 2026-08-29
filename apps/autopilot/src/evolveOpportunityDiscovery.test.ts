import { describe, expect, it } from "vitest";
import { discoverEvolutionOpportunities, type EvolutionDiscoverySignal } from "./evolveOpportunityDiscovery";

const signal = (overrides: Partial<EvolutionDiscoverySignal> = {}): EvolutionDiscoverySignal => ({
  id: "ci-regression-1",
  source: "github-actions",
  reference: "run/123",
  problem: "Repeated canonical CI regression detected",
  observedAt: "2026-08-29T05:30:00.000Z",
  evidenceQuality: 0.9,
  impact: 0.8,
  confidence: 0.9,
  risk: 0.2,
  reversibility: 0.9,
  ...overrides,
});

describe("discoverEvolutionOpportunities", () => {
  it("creates a bounded discovered opportunity without authority", () => {
    const result = discoverEvolutionOpportunities([signal()]);
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0]).toMatchObject({
      id: "discovery:ci-regression-1",
      status: "DISCOVERED",
      source: "github-actions",
    });
    expect(result.authority).toEqual({
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    });
  });

  it("rejects insufficient evidence and excessive risk fail closed", () => {
    const result = discoverEvolutionOpportunities([
      signal({ id: "weak", evidenceQuality: 0.49 }),
      signal({ id: "risky", risk: 0.81 }),
    ]);
    expect(result.opportunities).toHaveLength(0);
    expect(result.rejectedSignalIds).toEqual(["weak", "risky"]);
  });

  it("deduplicates signals and bounds discovery input", () => {
    const duplicate = signal({ id: "same" });
    const many = Array.from({ length: 70 }, (_, index) => signal({ id: `s${index}` }));
    expect(discoverEvolutionOpportunities([duplicate, duplicate]).opportunities).toHaveLength(1);
    expect(discoverEvolutionOpportunities(many).opportunities).toHaveLength(64);
  });
});
