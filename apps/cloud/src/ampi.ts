export interface AdaptivePortfolioInput {
  readonly baseWeights: Readonly<Record<string, number>>;
  readonly regimeConfidence: number;
  readonly liquidityScore: number;
  readonly uncertainty: number;
  readonly preservationMultiplier: number;
}

export interface AdaptivePortfolioResult {
  readonly weights: Readonly<Record<string, number>>;
  readonly totalWeight: number;
  readonly reasons: readonly string[];
  readonly recommendationOnly: true;
  readonly productionMutationAllowed: false;
}

const ratio = (value: number, field: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be between 0 and 1`);
};
const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

export const adaptPortfolioWeights = (input: AdaptivePortfolioInput): AdaptivePortfolioResult => {
  ratio(input.regimeConfidence, "regimeConfidence");
  ratio(input.liquidityScore, "liquidityScore");
  ratio(input.uncertainty, "uncertainty");
  ratio(input.preservationMultiplier, "preservationMultiplier");
  const entries = Object.entries(input.baseWeights).sort(([left], [right]) => left.localeCompare(right));
  const reasons: string[] = [];
  const multiplier = input.preservationMultiplier * input.regimeConfidence * input.liquidityScore * (1 - input.uncertainty);
  if (input.regimeConfidence < 0.5) reasons.push("REGIME_UNCERTAIN");
  if (input.liquidityScore < 0.5) reasons.push("LIQUIDITY_WEAK");
  if (input.uncertainty > 0.5) reasons.push("UNCERTAINTY_HIGH");
  const weights: Record<string, number> = {};
  let totalWeight = 0;
  for (const [strategyId, weight] of entries) {
    ratio(weight, `weight:${strategyId}`);
    const adapted = round(weight * multiplier);
    weights[strategyId] = adapted;
    totalWeight += adapted;
  }
  return Object.freeze({ weights: Object.freeze(weights), totalWeight: round(totalWeight), reasons: Object.freeze(reasons), recommendationOnly: true, productionMutationAllowed: false });
};
