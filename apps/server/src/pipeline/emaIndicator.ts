/**
 * The "Indicator(EMA)" stage: a single exponential moving average, decomposed out of
 * EmaCrossoverStrategy so it is its own pure, independently testable unit rather than
 * inline alpha-blend math. EmaCrossoverStrategy composes two of these (short/long period)
 * to detect crossovers; this class knows nothing about signals/intents/crossovers at all.
 */
export class EmaIndicator {
  private value: number | undefined;
  private readonly alpha: number;

  constructor(private readonly period: number) {
    if (!Number.isInteger(period) || period < 2) throw new Error("EMA period must be an integer >= 2");
    this.alpha = 2 / (period + 1);
  }

  /** Feeds one new price observation and returns the updated EMA value. */
  update(price: number): number {
    if (!Number.isFinite(price) || price <= 0) throw new Error("price must be positive and finite");
    this.value = this.value === undefined ? price : this.value + this.alpha * (price - this.value);
    return this.value;
  }

  get current(): number | undefined { return this.value; }
  get requiredPeriod(): number { return this.period; }

  reset(): void { this.value = undefined; }
}
