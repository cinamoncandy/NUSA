/**
 * What is actually true about each alpha, as a declaration a test can check against the source
 * tree rather than a claim in a document.
 *
 * Three alphas exist in this repository and none of them trades. Discovering why took reading
 * import graphs by hand, twice, and each answer was different:
 *
 *   - order-book imbalance: fully built and tested, never constructed outside its own folder,
 *     and holding for seconds against a 0.17% round trip it could never pay (ADR-0022..0024).
 *   - funding persistence: fully built, and UNFEEDABLE -- no code anywhere fetches a funding
 *     rate, and Upbit KRW is spot-only, so the input does not exist for this venue.
 *   - the 24h change rate: the only signal reaching a live decision, at a horizon that clears
 *     the cost floor, with no forecasting power demonstrated over 500 days (ADR-0025).
 *
 * The failure mode this guards is not "the strategy is bad". It is a strategy carrying tests,
 * a freeze step and a registry entry reading VALIDATED while nothing feeds it and nothing calls
 * it. Every field below is a claim; `tests/alpha-readiness.test.js` checks the checkable ones.
 */

export type AlphaWiring = "IN_EXECUTION_PATH" | "SELF_CONTAINED";
export type AlphaDataAvailability = "AVAILABLE" | "COLLECTABLE_FORWARD_ONLY" | "NOT_AVAILABLE_ON_VENUE";
export type AlphaEdgeStatus = "NOT_MEASURED" | "NO_EDGE_DEMONSTRATED" | "EDGE_DEMONSTRATED";

export interface AlphaReadiness {
  readonly alphaId: string;
  /** A symbol that only the execution path would import, used to check `wiring` against reality. */
  readonly entryPointSymbol: string;
  /** File or directory whose own contents do not count as callers: a module calling itself proves nothing. */
  readonly homePath: string;
  readonly wiring: AlphaWiring;
  readonly dataAvailability: AlphaDataAvailability;
  /** Typical holding period. Compare against UPBIT_MAJOR_HORIZON_FLOOR_HOURS before anything else. */
  readonly typicalHorizonHours: number;
  readonly edgeStatus: AlphaEdgeStatus;
  /** Where the claim comes from. An empty string is not permitted: a status with no evidence is a guess. */
  readonly evidence: string;
}

export const ALPHA_READINESS: readonly AlphaReadiness[] = Object.freeze([
  Object.freeze({
    alphaId: "orderbook-imbalance",
    entryPointSymbol: "evaluateOrderbookImbalanceStrategy",
    homePath: "apps/cloud/src/alpha/orderbook",
    wiring: "SELF_CONTAINED",
    dataAvailability: "COLLECTABLE_FORWARD_ONLY",
    typicalHorizonHours: 25 / 3600,
    edgeStatus: "NO_EDGE_DEMONSTRATED",
    evidence: "ADR-0022, ADR-0023: 21 trades no winners; gross loss tracks the spread; horizon four orders of magnitude below the floor"
  }),
  Object.freeze({
    alphaId: "funding-persistence",
    entryPointSymbol: "evaluateFundingPersistenceStrategy",
    homePath: "apps/cloud/src/alpha/funding",
    wiring: "SELF_CONTAINED",
    // Upbit KRW is spot-only. There is no perpetual, so no funding rate, and no code fetches one.
    dataAvailability: "NOT_AVAILABLE_ON_VENUE",
    typicalHorizonHours: 8,
    edgeStatus: "NOT_MEASURED",
    evidence: "no fetch of a funding rate exists anywhere in the repository; the input does not exist for Upbit KRW spot"
  }),
  Object.freeze({
    alphaId: "chart-change-rate-24h",
    entryPointSymbol: "upbitTickerToIntelligenceObservation",
    homePath: "apps/cloud/src/upbitTickerObservation.ts",
    wiring: "IN_EXECUTION_PATH",
    dataAvailability: "AVAILABLE",
    typicalHorizonHours: 24,
    edgeStatus: "NO_EDGE_DEMONSTRATED",
    evidence: "ADR-0025: 500 days, five majors, in-sample mean IC +0.0016, negative median and sub-0.5 win rate in five of five"
  })
]);

export interface AlphaReadinessProblem {
  readonly alphaId: string;
  readonly problem: string;
}

/**
 * Reasons an alpha must not be promoted, in the order they make further work pointless. Fails
 * closed: an unmeasured edge is a blocker, because "nobody checked" is the state every one of
 * these was in.
 */
export function blockersForPromotion(alpha: AlphaReadiness, horizonFloorHours: number): readonly AlphaReadinessProblem[] {
  const problems: AlphaReadinessProblem[] = [];
  const add = (problem: string): void => { problems.push(Object.freeze({ alphaId: alpha.alphaId, problem })); };
  if (!alpha.evidence.trim()) add("status is asserted with no evidence");
  if (alpha.dataAvailability === "NOT_AVAILABLE_ON_VENUE") add("its inputs do not exist on this venue; it cannot be fed, let alone measured");
  if (alpha.typicalHorizonHours < horizonFloorHours) add(`holds ${alpha.typicalHorizonHours}h against a ${horizonFloorHours}h floor; a perfect direction-caller would still lose`);
  if (alpha.edgeStatus === "NOT_MEASURED") add("edge has never been measured");
  if (alpha.edgeStatus === "NO_EDGE_DEMONSTRATED") add("no forecasting power has been demonstrated");
  if (alpha.wiring === "SELF_CONTAINED") add("nothing outside its own directory calls it, so it does not trade");
  return Object.freeze(problems);
}

/** True only when nothing blocks it. No alpha in this repository currently qualifies. */
export function isPromotable(alpha: AlphaReadiness, horizonFloorHours: number): boolean {
  return blockersForPromotion(alpha, horizonFloorHours).length === 0;
}
