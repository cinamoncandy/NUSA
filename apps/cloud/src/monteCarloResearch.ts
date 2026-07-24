import { createHash } from "node:crypto";

export interface MonteCarloSimulationInput {
  readonly returns: readonly number[];
  readonly pathCount: number;
  readonly horizon: number;
  readonly ruinThreshold: number;
  readonly seed: string;
}

export interface MonteCarloSimulationResult {
  readonly pathCount: number;
  readonly horizon: number;
  readonly ruinThreshold: number;
  readonly ruinProbability: number;
  readonly medianTerminalReturn: number;
  readonly fifthPercentileTerminalReturn: number;
  readonly seedHash: string;
}

const percentile = (values: readonly number[], fraction: number): number => {
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * fraction) - 1));
  return values[index]!;
};

const round8 = (value: number): number => Math.round(value * 100_000_000) / 100_000_000;

function seedState(seed: string): number {
  const hash = createHash("sha256").update(seed, "utf8").digest();
  const initial = hash.readUInt32BE(0);
  return initial === 0 ? 0x6d2b79f5 : initial;
}

function next(state: number): number {
  let value = state >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

export function runDeterministicMonteCarlo(input: MonteCarloSimulationInput): MonteCarloSimulationResult {
  if (!input.seed.trim()) throw new Error("Monte Carlo seed is required");
  if (!Number.isSafeInteger(input.pathCount) || input.pathCount < 100) throw new Error("Monte Carlo pathCount must be at least 100");
  if (!Number.isSafeInteger(input.horizon) || input.horizon < 1) throw new Error("Monte Carlo horizon must be a positive safe integer");
  if (!Number.isFinite(input.ruinThreshold) || input.ruinThreshold < 0 || input.ruinThreshold >= 1) throw new Error("Monte Carlo ruinThreshold must be within [0, 1)");
  if (input.returns.length < 2 || input.returns.some((value) => !Number.isFinite(value) || value <= -1)) {
    throw new Error("Monte Carlo returns must contain at least two finite values above -1");
  }

  const seedHash = createHash("sha256").update(input.seed, "utf8").digest("hex");
  let state = seedState(input.seed);
  let ruinedPaths = 0;
  const terminalReturns: number[] = [];

  for (let path = 0; path < input.pathCount; path += 1) {
    let equity = 1;
    let ruined = false;
    for (let step = 0; step < input.horizon; step += 1) {
      state = next(state);
      const sampled = input.returns[state % input.returns.length]!;
      equity *= 1 + sampled;
      if (equity <= input.ruinThreshold) ruined = true;
    }
    if (ruined) ruinedPaths += 1;
    terminalReturns.push(equity - 1);
  }

  terminalReturns.sort((left, right) => left - right);
  return Object.freeze({
    pathCount: input.pathCount,
    horizon: input.horizon,
    ruinThreshold: input.ruinThreshold,
    ruinProbability: round8(ruinedPaths / input.pathCount),
    medianTerminalReturn: round8(percentile(terminalReturns, 0.5)),
    fifthPercentileTerminalReturn: round8(percentile(terminalReturns, 0.05)),
    seedHash
  });
}
