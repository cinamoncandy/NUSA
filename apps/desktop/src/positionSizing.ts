/**
 * Fixed-fractional risk-based position sizing: a standard, well-established risk-
 * management technique (order size scales with account equity, not a fixed constant).
 * Addresses the investment-strategy audit's "fixed order quantity is not risk-based
 * sizing; it does not scale with equity" finding.
 *
 * This is a sizing mechanism only, not a trading edge or performance claim: a smaller
 * riskFraction can only ever produce an equal or smaller order than the current fixed-
 * quantity default, never a larger one relative to what an operator explicitly allows
 * elsewhere (PaperRiskPolicy.maxOrderNotional/maxPositionQuantity still apply downstream
 * in PaperBroker regardless of how the requested quantity was derived).
 *
 * Deliberately not wired into ControlPlane/RuntimeCommandService yet: control.orderQuantity
 * is currently a static, operator-settable, IPC-displayed number (apps/desktop/src/
 * controlPlane.ts, main.ts's "control:quantity" channel, the renderer). Making it a
 * function of live equity/price would change that contract for every caller and the
 * renderer surface, which is a larger, separately reviewable change -- not something to
 * fold in silently alongside a sizing utility.
 */

export interface FixedFractionalSizingInput {
  /** Current account equity (cash + market value of any open position), in the account's currency. */
  readonly equity: number;
  /** Current market price for the instrument being sized. */
  readonly price: number;
  /** Fraction of equity to risk on this order, in (0, 1]. Conservative defaults should be small (e.g. 0.01 = 1%). */
  readonly riskFraction: number;
  /** Optional quantity step to floor the result to, matching PaperBroker's own step/dust conventions. Unset returns the raw quotient. */
  readonly quantityStep?: number;
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive and finite`);
}

function decimalPlaces(value: number): number {
  const text = value.toString().toLowerCase();
  const exponentMarker = text.indexOf("e-");
  if (exponentMarker >= 0) return Number(text.slice(exponentMarker + 2));
  const decimalMarker = text.indexOf(".");
  return decimalMarker < 0 ? 0 : text.length - decimalMarker - 1;
}

function floorToStep(value: number, step: number): number {
  const precision = Math.min(15, Math.max(decimalPlaces(step), 0));
  const units = Math.floor((value + Number.EPSILON) / step);
  return Number((units * step).toFixed(precision));
}

/**
 * Computes quantity = (equity * riskFraction) / price, optionally floored to quantityStep.
 * Never returns a negative quantity; returns 0 if the floored result is below one step
 * (the caller/PaperBroker's own dust-threshold rejection already handles that case safely).
 */
export function calculateFixedFractionalQuantity(input: FixedFractionalSizingInput): number {
  assertPositiveFinite(input.equity, "equity");
  assertPositiveFinite(input.price, "price");
  if (!Number.isFinite(input.riskFraction) || input.riskFraction <= 0 || input.riskFraction > 1) {
    throw new Error("riskFraction must be in (0, 1]");
  }
  if (input.quantityStep !== undefined) assertPositiveFinite(input.quantityStep, "quantityStep");

  const rawQuantity = (input.equity * input.riskFraction) / input.price;
  return input.quantityStep === undefined ? rawQuantity : floorToStep(rawQuantity, input.quantityStep);
}
