export type ResidualAlphaCombinationStatus =
  | "READY"
  | "INSUFFICIENT_HISTORY"
  | "INSUFFICIENT_ACTIVE_SIGNALS"
  | "NO_INDEPENDENT_ALPHA";

export interface ResidualAlphaCombinerConfig {
  lookback: number;
  estimationWindow: number;
  minimumObservations: number;
  ridgePenalty: number;
  volatilityFloor: number;
}

export interface ResidualAlphaCombinationInput {
  /**
   * Realized strategy returns. Values at indexes >= asOfExclusive are ignored.
   * This explicit cutoff is the chronology boundary that prevents future data
   * from entering the research weight calculation.
   */
  returnsBySignal: Readonly<Record<string, readonly number[]>>;
  /** Current normalized strategy signals to combine. */
  currentSignals: Readonly<Record<string, number>>;
  /** First return index that is not yet observable. */
  asOfExclusive: number;
}

export interface ResidualAlphaSignalDiagnostic {
  volatility: number;
  independentAlpha: number;
  residualRms: number;
  rawWeight: number;
  weight: number;
  active: boolean;
}

export interface ResidualAlphaCombinationResult {
  status: ResidualAlphaCombinationStatus;
  combinedSignal: number;
  weights: Readonly<Record<string, number>>;
  diagnostics: Readonly<Record<string, ResidualAlphaSignalDiagnostic>>;
  observationsUsed: number;
  asOfExclusive: number;
  method: "RIDGE_RESIDUAL_ALPHA";
  mode: "PAPER_ONLY";
}

export class ResidualAlphaCombinerError extends Error {
  constructor(
    public readonly code:
      | "INVALID_CONFIG"
      | "INVALID_AS_OF"
      | "MISSING_HISTORY"
      | "NON_FINITE_RETURN"
      | "NON_FINITE_SIGNAL"
      | "SINGULAR_SYSTEM",
    message: string,
  ) {
    super(message);
    this.name = "ResidualAlphaCombinerError";
  }
}

export const DEFAULT_RESIDUAL_ALPHA_COMBINER_CONFIG: Readonly<ResidualAlphaCombinerConfig> = {
  lookback: 60,
  estimationWindow: 20,
  minimumObservations: 20,
  ridgePenalty: 1,
  volatilityFloor: 1e-8,
};

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rootMeanSquare(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
}

function zeroRecord(ids: readonly string[]): Record<string, number> {
  return Object.fromEntries(ids.map((id) => [id, 0]));
}

function validateConfig(config: ResidualAlphaCombinerConfig): void {
  const integerFields = [config.lookback, config.estimationWindow, config.minimumObservations];
  if (
    integerFields.some((value) => !Number.isInteger(value) || value <= 0) ||
    config.minimumObservations > config.lookback ||
    config.estimationWindow > config.lookback ||
    !Number.isFinite(config.ridgePenalty) ||
    config.ridgePenalty <= 0 ||
    !Number.isFinite(config.volatilityFloor) ||
    config.volatilityFloor <= 0
  ) {
    throw new ResidualAlphaCombinerError("INVALID_CONFIG", "Residual alpha combiner configuration is invalid");
  }
}

function solveLinearSystem(matrix: readonly (readonly number[])[], rhs: readonly number[]): number[] {
  const size = rhs.length;
  const augmented = matrix.map((row, index) => [...row, rhs[index]]);

  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivotRow][column])) pivotRow = row;
    }

    if (Math.abs(augmented[pivotRow][column]) < 1e-12) {
      throw new ResidualAlphaCombinerError("SINGULAR_SYSTEM", "Regularized residual-alpha system is singular");
    }

    [augmented[column], augmented[pivotRow]] = [augmented[pivotRow], augmented[column]];
    const pivot = augmented[column][column];
    for (let col = column; col <= size; col += 1) augmented[column][col] /= pivot;

    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      if (factor === 0) continue;
      for (let col = column; col <= size; col += 1) {
        augmented[row][col] -= factor * augmented[column][col];
      }
    }
  }

  return augmented.map((row) => row[size]);
}

/**
 * Returns the ridge prediction of one standardized return series from the
 * other standardized series. The smaller primal/dual system is solved so the
 * method remains regularized when signal count exceeds history length.
 */
function ridgePrediction(
  target: readonly number[],
  predictors: readonly (readonly number[])[],
  ridgePenalty: number,
): number[] {
  const observations = target.length;
  const featureCount = predictors.length;
  if (featureCount === 0) return Array.from({ length: observations }, () => 0);

  if (featureCount <= observations) {
    const gram = Array.from({ length: featureCount }, (_, row) =>
      Array.from({ length: featureCount }, (_, column) => {
        let value = row === column ? ridgePenalty : 0;
        for (let t = 0; t < observations; t += 1) value += predictors[row][t] * predictors[column][t];
        return value;
      }),
    );
    const rhs = predictors.map((series) => {
      let value = 0;
      for (let t = 0; t < observations; t += 1) value += series[t] * target[t];
      return value;
    });
    const beta = solveLinearSystem(gram, rhs);
    return Array.from({ length: observations }, (_, t) =>
      beta.reduce((value, coefficient, feature) => value + coefficient * predictors[feature][t], 0),
    );
  }

  const rowGram = Array.from({ length: observations }, (_, row) =>
    Array.from({ length: observations }, (_, column) => {
      let value = row === column ? ridgePenalty : 0;
      for (let feature = 0; feature < featureCount; feature += 1) {
        value += predictors[feature][row] * predictors[feature][column];
      }
      return value;
    }),
  );
  const dual = solveLinearSystem(rowGram, target);

  return Array.from({ length: observations }, (_, row) => {
    let prediction = 0;
    for (let column = 0; column < observations; column += 1) {
      let kernel = 0;
      for (let feature = 0; feature < featureCount; feature += 1) {
        kernel += predictors[feature][row] * predictors[feature][column];
      }
      prediction += kernel * dual[column];
    }
    return prediction;
  });
}

function emptyResult(
  status: Exclude<ResidualAlphaCombinationStatus, "READY">,
  ids: readonly string[],
  observationsUsed: number,
  asOfExclusive: number,
  volatilityBySignal: Readonly<Record<string, number>> = {},
): ResidualAlphaCombinationResult {
  const weights = zeroRecord(ids);
  const diagnostics = Object.fromEntries(
    ids.map((id) => [
      id,
      {
        volatility: volatilityBySignal[id] ?? 0,
        independentAlpha: 0,
        residualRms: 0,
        rawWeight: 0,
        weight: 0,
        active: (volatilityBySignal[id] ?? 0) > 0,
      } satisfies ResidualAlphaSignalDiagnostic,
    ]),
  );
  return {
    status,
    combinedSignal: 0,
    weights,
    diagnostics,
    observationsUsed,
    asOfExclusive,
    method: "RIDGE_RESIDUAL_ALPHA",
    mode: "PAPER_ONLY",
  };
}

/**
 * PAPER_ONLY research combiner.
 *
 * Keeps the useful parts of volatility standardization, redundancy removal,
 * residual-alpha scoring, inverse-volatility allocation, and gross-L1
 * normalization while explicitly excluding future returns and unstable OLS.
 * This function does not place orders or grant execution authority.
 */
export function combineResidualAlphaSignals(
  input: ResidualAlphaCombinationInput,
  partialConfig: Partial<ResidualAlphaCombinerConfig> = {},
): ResidualAlphaCombinationResult {
  const config: ResidualAlphaCombinerConfig = {
    ...DEFAULT_RESIDUAL_ALPHA_COMBINER_CONFIG,
    ...partialConfig,
  };
  validateConfig(config);

  if (!Number.isInteger(input.asOfExclusive) || input.asOfExclusive < 0) {
    throw new ResidualAlphaCombinerError("INVALID_AS_OF", "asOfExclusive must be a non-negative integer");
  }

  const ids = Object.keys(input.currentSignals).sort();
  for (const id of ids) {
    if (!Number.isFinite(input.currentSignals[id])) {
      throw new ResidualAlphaCombinerError("NON_FINITE_SIGNAL", `Current signal ${id} is not finite`);
    }
    const history = input.returnsBySignal[id];
    if (!history) throw new ResidualAlphaCombinerError("MISSING_HISTORY", `Missing return history for ${id}`);
    if (input.asOfExclusive > history.length) {
      throw new ResidualAlphaCombinerError("INVALID_AS_OF", `asOfExclusive exceeds return history for ${id}`);
    }
  }

  const start = Math.max(0, input.asOfExclusive - config.lookback);
  const observations = input.asOfExclusive - start;
  if (observations < config.minimumObservations || ids.length < 2) {
    return emptyResult("INSUFFICIENT_HISTORY", ids, observations, input.asOfExclusive);
  }

  const centeredBySignal: Record<string, number[]> = {};
  const volatilityBySignal: Record<string, number> = {};
  const standardizedBySignal: Record<string, number[]> = {};

  for (const id of ids) {
    const window = input.returnsBySignal[id].slice(start, input.asOfExclusive);
    if (window.some((value) => !Number.isFinite(value))) {
      throw new ResidualAlphaCombinerError("NON_FINITE_RETURN", `Return history for ${id} contains non-finite data`);
    }
    const windowMean = mean(window);
    const centered = window.map((value) => value - windowMean);
    const volatility = rootMeanSquare(centered);
    centeredBySignal[id] = centered;
    volatilityBySignal[id] = volatility;
    if (volatility >= config.volatilityFloor) {
      standardizedBySignal[id] = centered.map((value) => value / volatility);
    }
  }

  const activeIds = ids.filter((id) => volatilityBySignal[id] >= config.volatilityFloor);
  if (activeIds.length < 2) {
    return emptyResult(
      "INSUFFICIENT_ACTIVE_SIGNALS",
      ids,
      observations,
      input.asOfExclusive,
      volatilityBySignal,
    );
  }

  const estimationLength = Math.min(config.estimationWindow, observations);
  const rawWeights = zeroRecord(ids);
  const independentAlphaBySignal = zeroRecord(ids);
  const residualRmsBySignal = zeroRecord(ids);

  for (const id of activeIds) {
    const target = standardizedBySignal[id];
    const predictors = activeIds.filter((otherId) => otherId !== id).map((otherId) => standardizedBySignal[otherId]);
    const prediction = ridgePrediction(target, predictors, config.ridgePenalty);
    const residual = target.map((value, index) => value - prediction[index]);
    const recentResidual = residual.slice(residual.length - estimationLength);
    const independentAlpha = mean(recentResidual);
    independentAlphaBySignal[id] = independentAlpha;
    residualRmsBySignal[id] = rootMeanSquare(residual);
    rawWeights[id] = independentAlpha / Math.max(volatilityBySignal[id], config.volatilityFloor);
  }

  const grossRawWeight = ids.reduce((sum, id) => sum + Math.abs(rawWeights[id]), 0);
  if (!Number.isFinite(grossRawWeight) || grossRawWeight <= 1e-12) {
    return emptyResult("NO_INDEPENDENT_ALPHA", ids, observations, input.asOfExclusive, volatilityBySignal);
  }

  const weights = Object.fromEntries(ids.map((id) => [id, rawWeights[id] / grossRawWeight]));
  const diagnostics = Object.fromEntries(
    ids.map((id) => [
      id,
      {
        volatility: volatilityBySignal[id],
        independentAlpha: independentAlphaBySignal[id],
        residualRms: residualRmsBySignal[id],
        rawWeight: rawWeights[id],
        weight: weights[id],
        active: activeIds.includes(id),
      } satisfies ResidualAlphaSignalDiagnostic,
    ]),
  );
  const combinedSignal = ids.reduce((sum, id) => sum + weights[id] * input.currentSignals[id], 0);

  return {
    status: "READY",
    combinedSignal,
    weights,
    diagnostics,
    observationsUsed: observations,
    asOfExclusive: input.asOfExclusive,
    method: "RIDGE_RESIDUAL_ALPHA",
    mode: "PAPER_ONLY",
  };
}
