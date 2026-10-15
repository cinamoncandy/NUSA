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
  /** Price bands, highest first: the tick for a price p is the first band with p >= minPrice. */
  readonly tickBands: Known<readonly { readonly minPrice: number; readonly tick: number }[]>;
  readonly quantityStep: Known<number>;
  readonly minOrderNotional: Known<number>;
  /** One listed rate (bp) for the market, as the official docs state it. It does NOT say whether maker and taker differ. */
  readonly listedFeeBp: Known<number>;
  readonly makerFeeBp: Known<number>;
  readonly takerFeeBp: Known<number>;
  readonly makerRebateBp: Known<number>;
  readonly cancelReplaceLimits: Known<string>;
  readonly sequenceAndGapRules: Known<string>;
}

const UNKNOWN = Object.freeze({ status: "UNKNOWN" as const });

const TICK_SOURCE = "https://docs.upbit.com/kr/docs/krw-market-info";
// Read from the raw page (curl, not a summary) on 2026-10-15; the page says "Updated 5 months ago".
const VERIFIED_AT_MS = Date.UTC(2026, 9, 15);
const TICK_BANDS = Object.freeze([
  [2_000_000, 1000], [1_000_000, 1000], [500_000, 500], [100_000, 100], [50_000, 50], [10_000, 10], [5_000, 5], [1_000, 1], [100, 1],
  [10, 0.1], [1, 0.01], [0.1, 0.001], [0.01, 0.0001], [0.001, 0.00001], [0.0001, 0.000001], [0.00001, 0.0000001], [0, 0.00000001],
].map(([minPrice, tick]) => Object.freeze({ minPrice: minPrice!, tick: tick! })));

/** Only facts read from a dated official page are VERIFIED; quantity step and fees are not on it and stay UNKNOWN. */
export const UPBIT_KRW_SPOT_SPEC: VenueSpec = Object.freeze({
  venue: "UPBIT",
  product: "KRW_SPOT",
  documentationUrl: "https://docs.upbit.com",
  tickBands: Object.freeze({ status: "VERIFIED" as const, value: TICK_BANDS, sourceUrl: TICK_SOURCE, verifiedAtMs: VERIFIED_AT_MS }),
  quantityStep: UNKNOWN,
  minOrderNotional: Object.freeze({ status: "VERIFIED" as const, value: 5000, sourceUrl: TICK_SOURCE, verifiedAtMs: VERIFIED_AT_MS }),
  // docs.upbit.com Strategy Toolkit reference, fee table (Upbit KR): KRW 0.05%, BTC 0.25%, USDT 0.25%. That is the toolkit's built-in
  // market rule; the support-center fee page returned 403 here and was NOT read. Maker/taker split and rebate are not stated.
  listedFeeBp: Object.freeze({ status: "VERIFIED" as const, value: 5, sourceUrl: "https://docs.upbit.com/kr/docs/upbit-strategy-toolkit-reference", verifiedAtMs: VERIFIED_AT_MS }),
  makerFeeBp: UNKNOWN,
  takerFeeBp: UNKNOWN,
  makerRebateBp: UNKNOWN,
  cancelReplaceLimits: UNKNOWN,
  sequenceAndGapRules: UNKNOWN,
});

const REQUIRED_FOR_QUOTING = ["tickBands", "quantityStep", "minOrderNotional", "makerFeeBp", "takerFeeBp"] as const;

/** Fail-closed gate: returns the UNKNOWN fields that block quote simulation (empty list = simulation may proceed). */
export function unknownFieldsBlockingSimulation(spec: VenueSpec): readonly string[] {
  return REQUIRED_FOR_QUOTING.filter((key) => spec[key].status !== "VERIFIED");
}

/** Tick for a price from the VERIFIED bands; undefined (never a guess) when the bands are not verified or the price is invalid. */
export function tickForPrice(spec: VenueSpec, price: number): number | undefined {
  if (spec.tickBands.status !== "VERIFIED" || !Number.isFinite(price) || price <= 0) return undefined;
  return spec.tickBands.value.find((band) => price >= band.minPrice)?.tick;
}
