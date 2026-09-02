/**
 * Componentized gross-to-net economic cost decomposition for AI prediction evaluation
 * (WO-AI-011: Governed Longitudinal Held-Out Evaluation).
 *
 * A narrow slice of the larger planning-only work order. Closes only the "componentized
 * gross-to-net economic decomposition" and "unknown material economic cost terms fail closed
 * rather than defaulting to zero" requirements: predictive quality (an AI prediction being
 * directionally/numerically correct) is separate from economic usefulness (whether acting on it
 * would actually have made money after real costs). A gross benefit figure with an unresolved,
 * potentially material cost component must never be presented as if that component were zero --
 * that would overstate net benefit and could not be distinguished from an evaluation that
 * genuinely had no such cost.
 */

export type EconomicCostComponentKind =
  | "FEES" | "SPREAD" | "SLIPPAGE" | "IMPLEMENTATION_SHORTFALL" | "TURNOVER"
  | "FINANCING_BORROW_FUNDING_CARRY" | "FX" | "MARKET_IMPACT_CAPACITY" | "OPPORTUNITY_COST" | "PATH_RISK";

/** One cost component's contribution, or an explicit statement that it is not yet known. */
export type EconomicCostComponent =
  | { readonly kind: EconomicCostComponentKind; readonly known: true; readonly amount: number }
  | { readonly kind: EconomicCostComponentKind; readonly known: false };

export interface EconomicDecompositionInput {
  readonly grossBenefit: number;
  readonly components: readonly EconomicCostComponent[];
  /** Every cost kind the evaluation's frozen cost model declares as potentially material for this
   * evaluation family. A kind absent from `components` but present here is treated the same as an
   * unknown component -- silently omitting a declared-material cost is not equivalent to it being
   * absent/zero. */
  readonly materialKinds: readonly EconomicCostComponentKind[];
}

export type EconomicDecompositionResult =
  | { readonly resolved: true; readonly netBenefit: number; readonly totalCost: number; readonly componentTotals: Readonly<Record<EconomicCostComponentKind, number>> }
  | { readonly resolved: false; readonly reason: "UNKNOWN_MATERIAL_COST_COMPONENT" | "DUPLICATE_COMPONENT_KIND" | "INVALID_GROSS_BENEFIT" | "INVALID_COMPONENT_AMOUNT" };

/**
 * Decomposes gross benefit into net benefit after every declared-material cost component. Fails
 * closed rather than defaulting an unknown component to zero: if any kind in `materialKinds` is
 * missing from `components`, or present but marked `known: false`, the whole decomposition is
 * unresolved -- net benefit is never reported as if the unknown cost were zero. Also rejects a
 * duplicate component kind (ambiguous which value applies) and non-finite amounts/grossBenefit.
 */
export function decomposeEconomicCost(input: EconomicDecompositionInput): EconomicDecompositionResult {
  if (!Number.isFinite(input.grossBenefit)) return { resolved: false, reason: "INVALID_GROSS_BENEFIT" };

  const seen = new Set<EconomicCostComponentKind>();
  for (const component of input.components) {
    if (seen.has(component.kind)) return { resolved: false, reason: "DUPLICATE_COMPONENT_KIND" };
    seen.add(component.kind);
    if (component.known && !Number.isFinite(component.amount)) return { resolved: false, reason: "INVALID_COMPONENT_AMOUNT" };
  }

  const byKind = new Map(input.components.map((component) => [component.kind, component]));
  for (const materialKind of input.materialKinds) {
    const component = byKind.get(materialKind);
    if (component === undefined || !component.known) return { resolved: false, reason: "UNKNOWN_MATERIAL_COST_COMPONENT" };
  }

  const componentTotals = {} as Record<EconomicCostComponentKind, number>;
  let totalCost = 0;
  for (const component of input.components) {
    if (!component.known) continue;
    componentTotals[component.kind] = component.amount;
    totalCost += component.amount;
  }

  return { resolved: true, netBenefit: input.grossBenefit - totalCost, totalCost, componentTotals: Object.freeze(componentTotals) };
}
