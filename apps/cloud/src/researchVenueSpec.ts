/**
 * Research-only VenueSpec (WO-RESEARCH-20261015-RAIM-VENUESPEC). Records what is VERIFIED about a venue/product and marks
 * everything else UNKNOWN. A market-making simulator must refuse to price any field that is UNKNOWN. It places no orders,
 * grants no authority and replaces no Risk or PAPER path.
 */
export type Known<T> = { readonly status: "VERIFIED"; readonly value: T; readonly sourceUrl: string; readonly verifiedAtMs: number } | { readonly status: "UNKNOWN" };

export interface VenueSpec {
  readonly venue: string;
  readonly product: string;
  readonly documentationUrl: string;
  readonly tickSize: Known<number>;
  readonly quantityStep: Known<number>;
  readonly minOrderNotional: Known<number>;
  readonly makerFeeBp: Known<number>;
  readonly takerFeeBp: Known<number>;
  readonly makerRebateBp: Known<number>;
  readonly cancelReplaceLimits: Known<string>;
  readonly sequenceAndGapRules: Known<string>;
}

const UNKNOWN = Object.freeze({ status: "UNKNOWN" as const });

/** Nothing is VERIFIED yet: every market fact stays UNKNOWN until a dated official source is recorded. */
export const UPBIT_KRW_SPOT_SPEC: VenueSpec = Object.freeze({
  venue: "UPBIT",
  product: "KRW_SPOT",
  documentationUrl: "https://docs.upbit.com",
  tickSize: UNKNOWN,
  quantityStep: UNKNOWN,
  minOrderNotional: UNKNOWN,
  makerFeeBp: UNKNOWN,
  takerFeeBp: UNKNOWN,
  makerRebateBp: UNKNOWN,
  cancelReplaceLimits: UNKNOWN,
  sequenceAndGapRules: UNKNOWN,
});

const REQUIRED_FOR_QUOTING = ["tickSize", "quantityStep", "minOrderNotional", "makerFeeBp", "takerFeeBp"] as const;

/** Fail-closed gate: returns the UNKNOWN fields that block quote simulation (empty list = simulation may proceed). */
export function unknownFieldsBlockingSimulation(spec: VenueSpec): readonly string[] {
  return REQUIRED_FOR_QUOTING.filter((key) => spec[key].status !== "VERIFIED");
}
