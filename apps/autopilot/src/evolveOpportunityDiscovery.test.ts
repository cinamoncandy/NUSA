import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { discoverEvolutionOpportunities, type EvolutionDiscoverySignal } from "./evolveOpportunityDiscovery";

const NOW = new Date("2026-08-29T06:00:00.000Z");

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
    const result = discoverEvolutionOpportunities([signal()], NOW);
    assert.equal(result.opportunities.length, 1);
    assert.deepEqual(
      {
        id: result.opportunities[0]?.id,
        status: result.opportunities[0]?.status,
        source: result.opportunities[0]?.source,
      },
      {
        id: "discovery:ci-regression-1",
        status: "DISCOVERED",
        source: "github-actions",
      },
    );
    assert.deepEqual(result.authority, {
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    });
  });

  it("rejects insufficient evidence and excessive risk fail closed", () => {
    const result = discoverEvolutionOpportunities([
      signal({ id: "weak", evidenceQuality: 0.49 }),
      signal({ id: "risky", risk: 0.81 }),
    ], NOW);
    assert.equal(result.opportunities.length, 0);
    assert.deepEqual(result.rejectedSignalIds, ["weak", "risky"]);
  });

  it("rejects stale and implausibly future evidence", () => {
    const result = discoverEvolutionOpportunities([
      signal({ id: "stale", observedAt: "2026-08-29T04:59:59.999Z" }),
      signal({ id: "future", observedAt: "2026-08-29T06:05:00.001Z" }),
    ], NOW);
    assert.equal(result.opportunities.length, 0);
    assert.deepEqual(result.rejectedSignalIds, ["stale", "future"]);
  });

  it("rejects malformed scores and evidence text fail closed", () => {
    const result = discoverEvolutionOpportunities([
      signal({ id: "nan", confidence: Number.NaN }),
      signal({ id: "empty-ref", reference: "   " }),
    ], NOW);
    assert.equal(result.opportunities.length, 0);
    assert.deepEqual(result.rejectedSignalIds, ["nan", "empty-ref"]);
  });

  it("deduplicates signals and bounds discovery input", () => {
    const duplicate = signal({ id: "same" });
    const many = Array.from({ length: 70 }, (_, index) => signal({ id: `s${index}` }));
    assert.equal(discoverEvolutionOpportunities([duplicate, duplicate], NOW).opportunities.length, 1);
    assert.equal(discoverEvolutionOpportunities(many, NOW).opportunities.length, 64);
  });
});
