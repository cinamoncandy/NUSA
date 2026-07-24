export type EdgeDirection = "LONG" | "SHORT" | "NO_EDGE";

export interface ProbabilityEdgeInput {
  readonly symbol: string;
  readonly now: number;
  readonly modelProbabilityUp: number;
  readonly marketProbabilityUp: number;
  readonly confidence: number;
  readonly observedAt: number;
  readonly maxAgeMs: number;
  readonly estimatedRoundTripCost: number;
  readonly minimumNetEdge: number;
}

export interface ProbabilityEdgeResult {
  readonly symbol: string;
  readonly direction: EdgeDirection;
  readonly grossEdge: number;
  readonly netEdge: number;
  readonly confidence: number;
  readonly stale: boolean;
  readonly observedAt: number;
  readonly decidedAt: number;
}

const unit = (value: number, field: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${field} must be between 0 and 1`);
  }
};

const safeTime = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
};

const round6 = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

export function calculateProbabilityEdge(input: ProbabilityEdgeInput): ProbabilityEdgeResult {
  if (!input.symbol.trim()) throw new Error("symbol is required");
  safeTime(input.now, "now");
  safeTime(input.observedAt, "observedAt");
  safeTime(input.maxAgeMs, "maxAgeMs");
  if (input.observedAt > input.now) throw new Error("observedAt cannot be in the future");
  unit(input.modelProbabilityUp, "modelProbabilityUp");
  unit(input.marketProbabilityUp, "marketProbabilityUp");
  unit(input.confidence, "confidence");
  unit(input.estimatedRoundTripCost, "estimatedRoundTripCost");
  unit(input.minimumNetEdge, "minimumNetEdge");

  const stale = input.now - input.observedAt > input.maxAgeMs;
  const rawDifference = input.modelProbabilityUp - input.marketProbabilityUp;
  const grossEdge = round6(Math.abs(rawDifference) * input.confidence);
  const netEdge = round6(Math.max(0, grossEdge - input.estimatedRoundTripCost));

  let direction: EdgeDirection = "NO_EDGE";
  if (!stale && input.confidence > 0 && netEdge >= input.minimumNetEdge) {
    direction = rawDifference > 0 ? "LONG" : rawDifference < 0 ? "SHORT" : "NO_EDGE";
  }

  return Object.freeze({
    symbol: input.symbol.trim().toUpperCase(),
    direction,
    grossEdge,
    netEdge,
    confidence: input.confidence,
    stale,
    observedAt: input.observedAt,
    decidedAt: input.now
  });
}
