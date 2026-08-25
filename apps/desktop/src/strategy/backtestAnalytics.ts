import type { PaperOrder } from "../paper/paperBroker";

export interface MatchedTrade {
  readonly entryTime: number;
  readonly exitTime: number;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly quantity: number;
  readonly fees: number;
  readonly grossPnL: number;
  readonly netPnL: number;
  readonly holdingDuration: number;
}

export interface OpenPositionAnalysis {
  readonly status: "FLAT" | "OPEN_POSITION";
  readonly quantity: number;
  readonly averageEntryPrice?: number;
  readonly openedAt?: number;
}

export interface TradeMatchResult {
  readonly trades: readonly MatchedTrade[];
  readonly openPosition: OpenPositionAnalysis;
}

export interface PerformanceMetrics {
  readonly profitFactor?: number;
  readonly expectancy?: number;
  readonly averageWin?: number;
  readonly averageLoss?: number;
  readonly winRate: number;
  readonly lossRate: number;
  readonly payoffRatio?: number;
  readonly averageHoldingTime?: number;
  readonly exposure: number;
  readonly trades: number;
  readonly grossProfit: number;
  readonly grossLoss: number;
  readonly netWinningProfit: number;
  readonly netLosingLoss: number;
  readonly netProfit: number;
}

export interface EquityAnalytics {
  readonly maximumDrawdown: number;
  readonly longestDrawdown: number;
  readonly recoveryFactor?: number;
  readonly ulcerIndex: number;
  readonly equityCurveCsv: string;
}

export interface EquityPoint { readonly timestamp: number; readonly equity: number; }

interface OpenLot { readonly timestamp: number; readonly price: number; remaining: number; remainingFee: number; }

const immutable = <T>(value: T): Readonly<T> => Object.freeze(value);
const numeric = (value: number, name: string): void => { if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and non-negative`); };

/**
 * Quantities at or below this are arithmetic residue, not a position.
 *
 * Adding 0.1 and 0.2 in binary floating point gives 0.30000000000000004, so selling 0.3
 * leaves about 2.8e-17 behind. Comparing to exactly 0 then reports a fully closed position
 * as still open. `PaperBroker` already normalises this away with its own dust threshold; the
 * analytics did not, so one codebase gave two different answers about the same trades.
 *
 * 1e-12 sits four orders of magnitude below one satoshi (1e-8), the smallest quantity any
 * market here can trade, and five above the residue this exists to absorb. A position a
 * market could actually hold is never rounded away, and a residue never survives.
 */
const QUANTITY_DUST = 1e-12;

const isDust = (quantity: number): boolean => Math.abs(quantity) <= QUANTITY_DUST;

export function matchTrades(orders: readonly PaperOrder[]): TradeMatchResult {
  const lots: OpenLot[] = [];
  const trades: MatchedTrade[] = [];
  const chronological = [...orders].sort((left, right) => Date.parse(left.filledAt) - Date.parse(right.filledAt) || left.id.localeCompare(right.id));
  for (const order of chronological) {
    const timestamp = Date.parse(order.filledAt);
    if (!Number.isFinite(timestamp)) throw new Error("trade order filledAt must be a valid timestamp");
    numeric(order.quantity, "trade order quantity"); numeric(order.price, "trade order price"); numeric(order.fee, "trade order fee");
    if (isDust(order.quantity)) throw new Error("trade order quantity must be positive");
    if (order.side === "BUY") { lots.push({ timestamp, price: order.price, remaining: order.quantity, remainingFee: order.fee }); continue; }
    let quantity = order.quantity;
    let remainingExitFee = order.fee;
    while (!isDust(quantity)) {
      const lot = lots[0];
      if (!lot) throw new Error("trade matcher received an unmatched sell");
      const matchedQuantity = Math.min(quantity, lot.remaining);
      const entryFee = lot.remainingFee * (matchedQuantity / lot.remaining);
      const exitFee = remainingExitFee * (matchedQuantity / quantity);
      const grossPnL = (order.price - lot.price) * matchedQuantity;
      trades.push(immutable({ entryTime: lot.timestamp, exitTime: timestamp, entryPrice: lot.price, exitPrice: order.price, quantity: matchedQuantity, fees: entryFee + exitFee, grossPnL, netPnL: grossPnL - entryFee - exitFee, holdingDuration: timestamp - lot.timestamp }));
      lot.remaining -= matchedQuantity; lot.remainingFee -= entryFee; quantity -= matchedQuantity; remainingExitFee -= exitFee;
      if (isDust(lot.remaining)) lots.shift();
    }
  }
  const remaining = lots.filter((lot) => !isDust(lot.remaining));
  const quantity = remaining.reduce((sum, lot) => sum + lot.remaining, 0);
  const totalCost = remaining.reduce((sum, lot) => sum + lot.price * lot.remaining, 0);
  return immutable({ trades: Object.freeze(trades), openPosition: immutable(isDust(quantity) ? { status: "FLAT", quantity: 0 } : { status: "OPEN_POSITION", quantity, averageEntryPrice: totalCost / quantity, openedAt: remaining[0]?.timestamp }) });
}

export function calculateExposure(orders: readonly PaperOrder[], startTime: number, endTime: number): number {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) throw new Error("exposure timestamps are invalid");
  if (endTime === startTime) return 0;
  let quantity = 0; let previous = startTime; let exposed = 0;
  for (const order of [...orders].sort((a, b) => Date.parse(a.filledAt) - Date.parse(b.filledAt) || a.id.localeCompare(b.id))) {
    const timestamp = Date.parse(order.filledAt);
    if (timestamp < startTime || timestamp > endTime) continue;
    if (quantity > 0) exposed += timestamp - previous;
    quantity += order.side === "BUY" ? order.quantity : -order.quantity;
    if (isDust(quantity)) quantity = 0;
    previous = timestamp;
  }
  if (quantity > 0) exposed += endTime - previous;
  return exposed / (endTime - startTime);
}

export function calculatePerformanceMetrics(trades: readonly MatchedTrade[], exposure: number): PerformanceMetrics {
  if (!Number.isFinite(exposure) || exposure < 0 || exposure > 1) throw new Error("exposure must be between 0 and 1");
  const wins = trades.filter((trade) => trade.netPnL > 0); const losses = trades.filter((trade) => trade.netPnL < 0);
  const grossProfit = trades.filter((trade) => trade.grossPnL > 0).reduce((sum, trade) => sum + trade.grossPnL, 0);
  const grossLoss = trades.filter((trade) => trade.grossPnL < 0).reduce((sum, trade) => sum + -trade.grossPnL, 0);
  const netWinningProfit = wins.reduce((sum, trade) => sum + trade.netPnL, 0);
  const netLosingLoss = losses.reduce((sum, trade) => sum + -trade.netPnL, 0);
  const netProfit = trades.reduce((sum, trade) => sum + trade.netPnL, 0);
  const averageWin = wins.length ? netWinningProfit / wins.length : undefined;
  const averageLoss = losses.length ? netLosingLoss / losses.length : undefined;
  return immutable({
    profitFactor: netLosingLoss > 0 ? netWinningProfit / netLosingLoss : undefined,
    expectancy: trades.length ? netProfit / trades.length : undefined,
    averageWin, averageLoss,
    winRate: trades.length ? wins.length / trades.length : 0,
    lossRate: trades.length ? losses.length / trades.length : 0,
    payoffRatio: averageWin != null && averageLoss != null && averageLoss > 0 ? averageWin / averageLoss : undefined,
    averageHoldingTime: trades.length ? trades.reduce((sum, trade) => sum + trade.holdingDuration, 0) / trades.length : undefined,
    exposure, trades: trades.length, grossProfit, grossLoss, netWinningProfit, netLosingLoss, netProfit
  });
}

export function analyzeEquityCurve(curve: readonly EquityPoint[], netProfit: number): EquityAnalytics {
  if (curve.length === 0) throw new Error("equity curve must not be empty");
  let peak = curve[0]!.equity; let maximumDrawdown = 0; let maximumDrawdownAmount = 0; let drawdownStart: number | undefined; let longestDrawdown = 0; let squaredDrawdowns = 0;
  for (const point of curve) {
    if (!Number.isFinite(point.timestamp) || !Number.isFinite(point.equity) || point.equity < 0) throw new Error("equity curve contains invalid data");
    if (point.equity >= peak) { if (drawdownStart != null) longestDrawdown = Math.max(longestDrawdown, point.timestamp - drawdownStart); peak = point.equity; drawdownStart = undefined; }
    else {
      if (drawdownStart == null) drawdownStart = point.timestamp;
      const drawdown = peak === 0 ? 0 : (peak - point.equity) / peak;
      maximumDrawdown = Math.max(maximumDrawdown, drawdown); maximumDrawdownAmount = Math.max(maximumDrawdownAmount, peak - point.equity); squaredDrawdowns += drawdown * drawdown;
    }
  }
  const last = curve[curve.length - 1]!;
  if (drawdownStart != null) longestDrawdown = Math.max(longestDrawdown, last.timestamp - drawdownStart);
  return immutable({ maximumDrawdown, longestDrawdown, recoveryFactor: maximumDrawdownAmount > 0 ? netProfit / maximumDrawdownAmount : undefined, ulcerIndex: Math.sqrt(squaredDrawdowns / curve.length), equityCurveCsv: exportEquityCurve(curve) });
}

export function exportEquityCurve(curve: readonly EquityPoint[]): string {
  return `timestamp,equity\n${curve.map((point) => `${point.timestamp},${point.equity}`).join("\n")}`;
}
