import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decomposeEconomicCost, type EconomicCostComponent, type EconomicCostComponentKind } from "./aiEvaluationEconomicCostDecomposition";

const knownComponents: readonly EconomicCostComponent[] = [
  { kind: "FEES", known: true, amount: 10 },
  { kind: "SPREAD", known: true, amount: 5 },
  { kind: "SLIPPAGE", known: true, amount: 3 },
];

describe("decomposeEconomicCost", () => {
  it("resolves net benefit when every material component is known", () => {
    const result = decomposeEconomicCost({
      grossBenefit: 100,
      components: knownComponents,
      materialKinds: ["FEES", "SPREAD", "SLIPPAGE"],
    });
    assert.equal(result.resolved, true);
    assert.equal((result as { netBenefit: number }).netBenefit, 82);
    assert.equal((result as { totalCost: number }).totalCost, 18);
  });

  it("resolves when materialKinds is empty (no declared-material costs)", () => {
    const result = decomposeEconomicCost({ grossBenefit: 50, components: [], materialKinds: [] });
    assert.deepEqual(result, { resolved: true, netBenefit: 50, totalCost: 0, componentTotals: {} });
  });

  it("ignores a known component not declared material, but still nets it out", () => {
    const result = decomposeEconomicCost({
      grossBenefit: 100,
      components: [{ kind: "FEES", known: true, amount: 10 }],
      materialKinds: [],
    });
    assert.equal(result.resolved, true);
    assert.equal((result as { netBenefit: number }).netBenefit, 90);
  });

  it("fails closed when a declared-material component is entirely absent (never defaults to zero)", () => {
    const result = decomposeEconomicCost({
      grossBenefit: 100,
      components: [{ kind: "FEES", known: true, amount: 10 }],
      materialKinds: ["FEES", "OPPORTUNITY_COST"],
    });
    assert.deepEqual(result, { resolved: false, reason: "UNKNOWN_MATERIAL_COST_COMPONENT" });
  });

  it("fails closed when a declared-material component is explicitly marked unknown", () => {
    const result = decomposeEconomicCost({
      grossBenefit: 100,
      components: [{ kind: "FEES", known: true, amount: 10 }, { kind: "MARKET_IMPACT_CAPACITY", known: false }],
      materialKinds: ["FEES", "MARKET_IMPACT_CAPACITY"],
    });
    assert.deepEqual(result, { resolved: false, reason: "UNKNOWN_MATERIAL_COST_COMPONENT" });
  });

  it("fails closed on a duplicate component kind (ambiguous value)", () => {
    const duplicate: readonly EconomicCostComponent[] = [
      { kind: "FEES", known: true, amount: 10 },
      { kind: "FEES", known: true, amount: 20 },
    ];
    const result = decomposeEconomicCost({ grossBenefit: 100, components: duplicate, materialKinds: [] });
    assert.deepEqual(result, { resolved: false, reason: "DUPLICATE_COMPONENT_KIND" });
  });

  it("fails closed on a non-finite grossBenefit", () => {
    const result = decomposeEconomicCost({ grossBenefit: Number.NaN, components: [], materialKinds: [] });
    assert.deepEqual(result, { resolved: false, reason: "INVALID_GROSS_BENEFIT" });
  });

  it("fails closed on a non-finite known component amount", () => {
    const result = decomposeEconomicCost({
      grossBenefit: 100,
      components: [{ kind: "FEES", known: true, amount: Number.POSITIVE_INFINITY }],
      materialKinds: [],
    });
    assert.deepEqual(result, { resolved: false, reason: "INVALID_COMPONENT_AMOUNT" });
  });

  it("covers all ten declared component kinds when fully known", () => {
    const allKinds: readonly EconomicCostComponentKind[] = [
      "FEES", "SPREAD", "SLIPPAGE", "IMPLEMENTATION_SHORTFALL", "TURNOVER",
      "FINANCING_BORROW_FUNDING_CARRY", "FX", "MARKET_IMPACT_CAPACITY", "OPPORTUNITY_COST", "PATH_RISK",
    ];
    const components: readonly EconomicCostComponent[] = allKinds.map((kind) => ({ kind, known: true, amount: 1 }));
    const result = decomposeEconomicCost({ grossBenefit: 100, components, materialKinds: allKinds });
    assert.equal(result.resolved, true);
    assert.equal((result as { totalCost: number }).totalCost, 10);
    assert.equal((result as { netBenefit: number }).netBenefit, 90);
  });
});
