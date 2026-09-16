import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CloudRuntimeDashboardHydrator } from "./cloudRuntimeDashboardHydrator";
import { InMemoryCloudDashboardStateProvider } from "./cloudDashboardStateProvider";
import type { PaperCandidateExecutionBinding } from "./cioDecisionEngine";

const HASH = "a".repeat(64);
const principal = Object.freeze({ userId: "operator", scopes: Object.freeze(["dashboard:read"]) });

function binding(overrides: Partial<PaperCandidateExecutionBinding> = {}): PaperCandidateExecutionBinding {
  return {
    schemaVersion: 1,
    status: "BOUND_UNVERIFIED",
    authority: "PAPER_RESEARCH_ONLY",
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    candidateId: "challenger-immutable-v9",
    datasetId: "dataset-point-in-time-7",
    datasetContentSha256: HASH,
    advisoryGeneratedAt: 1_000,
    periodStartAt: 2_000,
    advisoryFingerprintSha256: HASH,
    bindingFingerprintSha256: HASH,
    ...overrides,
  };
}

const observation = Object.freeze({
  id: "market-1",
  source: "CHART" as const,
  market: "KRW-BTC",
  sentiment: 0.8,
  confidence: 0.9,
  observedAt: 2_900,
  expiresAt: 4_000,
  summary: "point-in-time market signal",
});

const pricedObservations = Object.freeze([100, 101, 103].map((price, index) => Object.freeze({
  ...observation,
  id: `priced-${index}`,
  price,
  observedAt: 2_900 + index,
  expiresAt: 4_000,
})));

describe("CloudRuntimeDashboardHydrator PAPER challenger composition", () => {
  it("carries the active immutable PAPER binding into the production CIO decision", () => {
    const provider = new InMemoryCloudDashboardStateProvider();
    const hydrator = new CloudRuntimeDashboardHydrator({
      now: () => 3_000,
      paperCandidateBindingProvider: { read: (market, decisionAt) => {
        assert.equal(market, "KRW-BTC");
        assert.equal(decisionAt, 3_000);
        return binding();
      } },
    });
    hydrator.hydrate(provider, [observation]);
    const state = provider.read(principal);
    assert.ok(state);
    assert.equal(state.decisions.length, 1);
    assert.equal(state.decisions[0]?.paperCandidateBinding?.candidateId, "challenger-immutable-v9");
    assert.equal(state.decisions[0]?.paperCandidateBinding?.status, "BOUND_UNVERIFIED");
    assert.equal(state.decisions[0]?.paperCandidateBinding?.liveAuthority, "NONE");
    assert.equal(state.decisions[0]?.paperCandidateBinding?.productionMutationAllowed, false);
  });

  it("uses the bound candidate strategy semantics instead of the generic market score", () => {
    const provider = new InMemoryCloudDashboardStateProvider();
    const hydrator = new CloudRuntimeDashboardHydrator({
      now: () => 3_000,
      paperCandidateBindingProvider: { read: () => binding({
        candidateStrategy: Object.freeze({ candidateId: "challenger-immutable-v9", familyId: "sma-crossover", lineageId: "sma-v1", specificationHash: HASH, codeSha: "b".repeat(40), costModelVersion: "cost-v1", parameters: Object.freeze({ shortPeriod: 2, longPeriod: 3 }) }),
      }) },
    });
    hydrator.hydrate(provider, pricedObservations);
    const state = provider.read(principal);
    assert.ok(state);
    assert.equal(state.decisions[0]?.action, "BUY");
    assert.equal(state.decisions[0]?.paperCandidateStrategyDecision?.action, "BUY");
    assert.match(state.decisions[0]?.reasons[0] ?? "", /^PAPER_CANDIDATE:sma-crossover:/);
  });

  it("keeps ordinary champion PAPER decisions unbound when no challenger is active", () => {
    const provider = new InMemoryCloudDashboardStateProvider();
    new CloudRuntimeDashboardHydrator({ now: () => 3_000 }).hydrate(provider, [observation]);
    const state = provider.read(principal);
    assert.ok(state);
    assert.equal(state.decisions[0]?.paperCandidateBinding, undefined);
  });

  it("fails closed when the active binding contains lookahead provenance", () => {
    const provider = new InMemoryCloudDashboardStateProvider();
    const hydrator = new CloudRuntimeDashboardHydrator({
      now: () => 3_000,
      paperCandidateBindingProvider: { read: () => binding({ advisoryGeneratedAt: 2_500, periodStartAt: 2_000 }) },
    });
    hydrator.hydrate(provider, [observation]);
    assert.equal(provider.read(principal), undefined);
  });

  it("fails closed when an active binding provider errors instead of silently dropping challenger provenance", () => {
    const provider = new InMemoryCloudDashboardStateProvider();
    const hydrator = new CloudRuntimeDashboardHydrator({
      now: () => 3_000,
      paperCandidateBindingProvider: { read: () => { throw new Error("durable challenger state unavailable"); } },
    });
    hydrator.hydrate(provider, [observation]);
    assert.equal(provider.read(principal), undefined);
  });
});
