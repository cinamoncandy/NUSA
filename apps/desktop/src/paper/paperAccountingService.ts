import { PaperBroker, type PaperAccountSnapshot, type PaperBrokerState, type PaperOrder, type PaperRiskPolicy } from "./paperBroker";

export interface FixedPrecisionPolicy { readonly scale: number; }
export interface PaperAccountState { readonly accountId: string; readonly broker: PaperBrokerState; }

export class FixedPrecision {
  public readonly scale: number;
  public constructor(policy: FixedPrecisionPolicy) {
    if (!Number.isSafeInteger(policy.scale) || policy.scale <= 0) throw new Error("precision scale must be a positive safe integer");
    this.scale = policy.scale;
  }
  public toUnits(value: number): bigint {
    if (!Number.isFinite(value)) throw new Error("financial value must be finite");
    const negative = value < 0;
    const fixed = Math.abs(value).toFixed(12).split(".");
    const numerator = BigInt(fixed[0] + (fixed[1] ?? ""));
    const denominator = 10n ** 12n;
    const scaled = numerator * BigInt(this.scale);
    const rounded = (scaled + denominator / 2n) / denominator;
    return negative ? -rounded : rounded;
  }
  public fromUnits(value: bigint): number { return Number(value) / this.scale; }
  public round(value: number): number { return this.fromUnits(this.toUnits(value)); }
}

const id = (value: string, field: string): string => { const normalized = value.trim(); if (!normalized) throw new Error(`${field} must not be empty`); return normalized; };

export class PaperAccountingService {
  private readonly accounts = new Map<string, PaperBroker>();
  public constructor(private readonly precision: FixedPrecision) {}

  public openAccount(accountId: string, initialCash: number, market: string, feeRate = 0.0005, policy: PaperRiskPolicy = {}): void {
    const normalized = id(accountId, "accountId");
    if (this.accounts.has(normalized)) throw new Error("account is already open");
    this.accounts.set(normalized, new PaperBroker(this.precision.round(initialCash), market, feeRate, policy));
  }

  public restoreAccount(state: PaperAccountState): void {
    const accountId = id(state.accountId, "accountId");
    if (this.accounts.has(accountId)) throw new Error("account is already open");
    const market = state.broker.position.market;
    this.accounts.set(accountId, new PaperBroker(1, market, state.broker.feeRate, {}, state.broker));
  }

  public execute(accountId: string, side: "BUY" | "SELL", quantity: number, price: number, now = new Date()): PaperOrder {
    return this.requireAccount(accountId).execute(side, this.precision.round(quantity), this.precision.round(price), now);
  }

  public snapshot(accountId: string, markPrice: number): PaperAccountSnapshot {
    const snapshot = this.requireAccount(accountId).snapshot(this.precision.round(markPrice));
    return Object.freeze({
      ...snapshot,
      cash: this.precision.round(snapshot.cash),
      equity: this.precision.round(snapshot.equity),
      unrealizedPnl: this.precision.round(snapshot.unrealizedPnl),
      position: Object.freeze({ ...snapshot.position, quantity: this.precision.round(snapshot.position.quantity), averagePrice: this.precision.round(snapshot.position.averagePrice), realizedPnl: this.precision.round(snapshot.position.realizedPnl) })
    });
  }

  public exportAccount(accountId: string): PaperAccountState { return Object.freeze({ accountId: id(accountId, "accountId"), broker: this.requireAccount(accountId).exportState() }); }
  public listAccountIds(): readonly string[] { return Object.freeze([...this.accounts.keys()]); }
  private requireAccount(accountId: string): PaperBroker { const broker = this.accounts.get(id(accountId, "accountId")); if (!broker) throw new Error("account is not open"); return broker; }
}
