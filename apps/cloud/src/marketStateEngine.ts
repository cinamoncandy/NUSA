export type MarketRegime =
  | "TREND_UP"
  | "TREND_DOWN"
  | "RANGE"
  | "HIGH_VOLATILITY"
  | "LIQUIDITY_STRESS";

export type MarketSignalName =
  | "RETURN_5M"
  | "REALIZED_VOLATILITY"
  | "SPREAD_BPS"
  | "ORDER_BOOK_IMBALANCE"
  | "DEPTH_USD"
  | "FUNDING_RATE"
  | "OPEN_INTEREST_CHANGE"
  | "LIQUIDATION_INTENSITY";

export interface MarketSignalObservation {
  readonly name: MarketSignalName;
  readonly value: number;
  readonly observedAt: string;
  readonly source: string;
  readonly sourceVersion: string;
}

export interface MarketStateInput {
  readonly market: string;
  readonly generatedAt: string;
  readonly maxSignalAgeMs: number;
  readonly minimumDepthUsd: number;
  readonly observations: readonly MarketSignalObservation[];
}

export interface MarketStateProvenance {
  readonly name: MarketSignalName;
  readonly observedAt: string;
  readonly source: string;
  readonly sourceVersion: string;
}

export interface MarketStateSnapshot {
  readonly market: string;
  readonly regime: MarketRegime;
  readonly trendScore: number;
  readonly volatilityScore: number;
  readonly liquidityScore: number;
  readonly stressScore: number;
  readonly uncertaintyScore: number;
  readonly confidence: number;
  readonly generatedAt: string;
  readonly provenance: readonly MarketStateProvenance[];
}

const REQUIRED_SIGNALS: readonly MarketSignalName[] = Object.freeze([
  "RETURN_5M",
  "REALIZED_VOLATILITY",
  "SPREAD_BPS",
  "ORDER_BOOK_IMBALANCE",
  "DEPTH_USD",
  "FUNDING_RATE",
  "OPEN_INTEREST_CHANGE",
  "LIQUIDATION_INTENSITY"
]);

const clamp = (value: number, minimum = 0, maximum = 1): number =>
  Math.min(maximum, Math.max(minimum, value));

const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

const parseTimestamp = (value: string, label: string): number => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be a valid ISO timestamp`);
  return timestamp;
};

const requireFiniteNonNegative = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and non-negative`);
};

const freezeSnapshot = (snapshot: MarketStateSnapshot): MarketStateSnapshot => {
  for (const item of snapshot.provenance) Object.freeze(item);
  Object.freeze(snapshot.provenance);
  return Object.freeze(snapshot);
};

export const createMarketState = (input: MarketStateInput): MarketStateSnapshot => {
  if (!input.market.trim()) throw new Error("market is required");
  requireFiniteNonNegative(input.maxSignalAgeMs, "maxSignalAgeMs");
  if (input.maxSignalAgeMs === 0) throw new Error("maxSignalAgeMs must be greater than zero");
  requireFiniteNonNegative(input.minimumDepthUsd, "minimumDepthUsd");
  if (input.minimumDepthUsd === 0) throw new Error("minimumDepthUsd must be greater than zero");

  const generatedAtMs = parseTimestamp(input.generatedAt, "generatedAt");
  const observationMap = new Map<MarketSignalName, MarketSignalObservation>();

  for (const observation of input.observations) {
    if (observationMap.has(observation.name)) throw new Error(`duplicate market signal ${observation.name}`);
    if (!Number.isFinite(observation.value)) throw new Error(`${observation.name} value must be finite`);
    if (!observation.source.trim()) throw new Error(`${observation.name} source is required`);
    if (!observation.sourceVersion.trim()) throw new Error(`${observation.name} sourceVersion is required`);

    const observedAtMs = parseTimestamp(observation.observedAt, `${observation.name} observedAt`);
    const ageMs = generatedAtMs - observedAtMs;
    if (ageMs < 0) throw new Error(`${observation.name} cannot be observed in the future`);
    if (ageMs > input.maxSignalAgeMs) throw new Error(`${observation.name} is stale`);
    observationMap.set(observation.name, observation);
  }

  for (const name of REQUIRED_SIGNALS) {
    if (!observationMap.has(name)) throw new Error(`required market signal ${name} is missing`);
  }

  const value = (name: MarketSignalName): number => observationMap.get(name)!.value;
  const return5m = clamp(value("RETURN_5M") / 0.02, -1, 1);
  const imbalance = clamp(value("ORDER_BOOK_IMBALANCE"), -1, 1);
  const openInterestChange = clamp(value("OPEN_INTEREST_CHANGE") / 0.10, -1, 1);
  const funding = clamp(value("FUNDING_RATE") / 0.001, -1, 1);

  const volatilityScore = clamp(value("REALIZED_VOLATILITY") / 0.08);
  const spreadStress = clamp(value("SPREAD_BPS") / 50);
  const depthScore = clamp(value("DEPTH_USD") / input.minimumDepthUsd);
  const liquidationStress = clamp(value("LIQUIDATION_INTENSITY"));

  const directional = (return5m * 0.45) + (imbalance * 0.25) + (openInterestChange * 0.20) + (funding * 0.10);
  const trendScore = round(clamp((directional + 1) / 2));
  const liquidityScore = round(clamp((depthScore * 0.70) + ((1 - spreadStress) * 0.30)));
  const stressScore = round(clamp((volatilityScore * 0.35) + (spreadStress * 0.30) + (liquidationStress * 0.35)));

  const disagreement = Math.min(1, Math.abs(return5m - imbalance) / 2 + Math.abs(return5m - openInterestChange) / 2);
  const uncertaintyScore = round(clamp((disagreement * 0.45) + (stressScore * 0.35) + ((1 - liquidityScore) * 0.20)));
  const confidence = round(clamp(1 - uncertaintyScore));

  let regime: MarketRegime;
  if (liquidityScore < 0.35 || stressScore >= 0.80) regime = "LIQUIDITY_STRESS";
  else if (volatilityScore >= 0.75) regime = "HIGH_VOLATILITY";
  else if (trendScore >= 0.65) regime = "TREND_UP";
  else if (trendScore <= 0.35) regime = "TREND_DOWN";
  else regime = "RANGE";

  const provenance = REQUIRED_SIGNALS.map((name) => {
    const observation = observationMap.get(name)!;
    return {
      name,
      observedAt: observation.observedAt,
      source: observation.source,
      sourceVersion: observation.sourceVersion
    };
  });

  return freezeSnapshot({
    market: input.market,
    regime,
    trendScore,
    volatilityScore: round(volatilityScore),
    liquidityScore,
    stressScore,
    uncertaintyScore,
    confidence,
    generatedAt: input.generatedAt,
    provenance
  });
};
