export type MarketRegime = "TRENDING" | "RANGING" | "VOLATILE" | "UNKNOWN";

export interface WorldModelInput {
  readonly snapshotId: string;
  readonly observedAt: number;
  readonly source: string;
  readonly price: number;
  readonly volatility: number;
  readonly liquidity: number;
  readonly trendStrength: number;
  readonly evidenceQuality: "VERIFIED" | "PROVISIONAL" | "STALE" | "CONFLICTED" | "UNKNOWN";
}

export interface WorldModelSnapshot extends WorldModelInput {
  readonly regime: MarketRegime;
  readonly confidence: number;
  readonly recommendationOnly: true;
}

const ratio = (value: number, field: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be between 0 and 1`);
};

export const buildWorldModelSnapshot = (input: WorldModelInput, now: number): WorldModelSnapshot => {
  if (!input.snapshotId.trim() || !input.source.trim()) throw new Error("snapshot identity is required");
  if (!Number.isSafeInteger(input.observedAt) || input.observedAt < 0 || input.observedAt > now) throw new Error("snapshot timestamp is invalid");
  if (!Number.isFinite(input.price) || input.price <= 0) throw new Error("price must be positive");
  ratio(input.volatility, "volatility");
  ratio(input.liquidity, "liquidity");
  ratio(input.trendStrength, "trendStrength");
  const confidence = input.evidenceQuality === "VERIFIED" ? 1 : input.evidenceQuality === "PROVISIONAL" ? 0.5 : 0;
  const regime = confidence === 0 ? "UNKNOWN" : input.volatility >= 0.7 ? "VOLATILE" : input.trendStrength >= 0.6 ? "TRENDING" : "RANGING";
  return Object.freeze({ ...input, regime, confidence, recommendationOnly: true });
};
