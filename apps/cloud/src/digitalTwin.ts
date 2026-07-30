import type { MarketRegime } from "./worldModel";

export interface DigitalTwinInput {
  readonly twinId: string;
  readonly sourceSnapshotId: string;
  readonly observedAt: number;
  readonly regime: MarketRegime;
  readonly price: number;
  readonly volatility: number;
  readonly liquidity: number;
  readonly simulated: boolean;
}

export interface DigitalTwinSnapshot extends DigitalTwinInput {
  readonly provenance: "WORLD_MODEL";
  readonly productionMutationAllowed: false;
}

export const createDigitalTwin = (input: DigitalTwinInput, now: number): DigitalTwinSnapshot => {
  if (!input.twinId.trim() || !input.sourceSnapshotId.trim()) throw new Error("digital twin identity is required");
  if (!Number.isSafeInteger(input.observedAt) || input.observedAt < 0 || input.observedAt > now) throw new Error("digital twin timestamp is invalid");
  if (!Number.isFinite(input.price) || input.price <= 0 || !Number.isFinite(input.volatility) || input.volatility < 0 || input.volatility > 1 || !Number.isFinite(input.liquidity) || input.liquidity < 0 || input.liquidity > 1) throw new Error("digital twin metrics are invalid");
  if (!input.simulated) throw new Error("digital twin must be explicitly simulated");
  return Object.freeze({ ...input, provenance: "WORLD_MODEL", productionMutationAllowed: false });
};
