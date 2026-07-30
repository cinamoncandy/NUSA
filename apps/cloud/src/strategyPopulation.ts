export interface StrategyCandidate {
  readonly strategyId: string;
  readonly version: string;
  readonly expectedReturn: number;
  readonly maximumDrawdown: number;
  readonly evidenceComplete: boolean;
  readonly certified: boolean;
}

export interface StrategyPopulationPolicy {
  readonly maximumDrawdown: number;
  readonly requireEvidence: boolean;
  readonly requireCertification: boolean;
  readonly maximumPopulation: number;
}

export interface StrategyPopulationResult {
  readonly eligible: readonly StrategyCandidate[];
  readonly rejected: readonly string[];
  readonly automaticPromotionAllowed: false;
}

export const selectStrategyPopulation = (candidates: readonly StrategyCandidate[], policy: StrategyPopulationPolicy): StrategyPopulationResult => {
  if (!Number.isFinite(policy.maximumDrawdown) || policy.maximumDrawdown < 0 || policy.maximumDrawdown > 1) throw new Error("maximumDrawdown must be between 0 and 1");
  if (!Number.isSafeInteger(policy.maximumPopulation) || policy.maximumPopulation < 1) throw new Error("maximumPopulation must be positive");
  const ids = new Set<string>();
  const rejected: string[] = [];
  const eligible: StrategyCandidate[] = [];
  for (const candidate of candidates) {
    if (!candidate.strategyId.trim() || !candidate.version.trim()) throw new Error("strategy identity is required");
    const key = `${candidate.strategyId}@${candidate.version}`;
    if (ids.has(key)) throw new Error(`duplicate strategy candidate: ${key}`);
    ids.add(key);
    if (!Number.isFinite(candidate.expectedReturn) || !Number.isFinite(candidate.maximumDrawdown) || candidate.maximumDrawdown < 0 || candidate.maximumDrawdown > 1) throw new Error("strategy metrics are invalid");
    const reason = candidate.maximumDrawdown > policy.maximumDrawdown || (policy.requireEvidence && !candidate.evidenceComplete) || (policy.requireCertification && !candidate.certified);
    if (reason) rejected.push(key); else eligible.push(candidate);
  }
  eligible.sort((left, right) => right.expectedReturn - left.expectedReturn || left.strategyId.localeCompare(right.strategyId) || left.version.localeCompare(right.version));
  return Object.freeze({ eligible: Object.freeze(eligible.slice(0, policy.maximumPopulation)), rejected: Object.freeze(rejected), automaticPromotionAllowed: false as const });
};
