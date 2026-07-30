export interface SimulationScenario {
  readonly scenarioId: string;
  readonly returnShock: number;
  readonly liquidityMultiplier: number;
}

export interface SimulationInput {
  readonly startingCapital: number;
  readonly portfolioWeight: number;
  readonly scenarios: readonly SimulationScenario[];
}

export interface SimulationResult {
  readonly scenarioId: string;
  readonly endingCapital: number;
  readonly drawdown: number;
  readonly liquidityMultiplier: number;
}

export interface SimulationReport {
  readonly results: readonly SimulationResult[];
  readonly worstCaseScenarioId: string;
  readonly productionMutationAllowed: false;
  readonly sideEffectFree: true;
}

const ratio = (value: number, field: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be between 0 and 1`);
};
const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

export const simulatePortfolio = (input: SimulationInput): SimulationReport => {
  if (!Number.isFinite(input.startingCapital) || input.startingCapital <= 0) throw new Error("startingCapital must be positive");
  ratio(input.portfolioWeight, "portfolioWeight");
  const ids = new Set<string>();
  const results = input.scenarios.map((scenario) => {
    if (!scenario.scenarioId.trim() || ids.has(scenario.scenarioId)) throw new Error("scenario ids must be unique");
    ids.add(scenario.scenarioId);
    if (!Number.isFinite(scenario.returnShock) || scenario.returnShock < -1 || scenario.returnShock > 1) throw new Error("returnShock is invalid");
    ratio(scenario.liquidityMultiplier, "liquidityMultiplier");
    const endingCapital = round(input.startingCapital * (1 + input.portfolioWeight * scenario.returnShock));
    return Object.freeze({ scenarioId: scenario.scenarioId, endingCapital, drawdown: round(Math.max(0, (input.startingCapital - endingCapital) / input.startingCapital)), liquidityMultiplier: scenario.liquidityMultiplier });
  }).sort((left, right) => left.endingCapital - right.endingCapital || left.scenarioId.localeCompare(right.scenarioId));
  if (results.length === 0) throw new Error("simulation requires scenarios");
  return Object.freeze({ results: Object.freeze(results), worstCaseScenarioId: results[0].scenarioId, productionMutationAllowed: false, sideEffectFree: true });
};
