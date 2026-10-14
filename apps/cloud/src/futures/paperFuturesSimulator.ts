import type {
  PaperFuturesAccount, PaperFuturesCostProfile, PaperFuturesLedgerEntry, PaperFuturesOrderIntent, PaperFuturesPosition, PaperFuturesSide,
} from "../../../../packages/contracts/src/paperFutures";

/**
 * Deterministic PAPER simulator for USD-M perpetual futures (design v1 §3, B2). Pure: every function returns a new
 * frozen account and never mutates its input, reads a clock, touches the network or holds a credential.
 *
 * Model (stated simplifications, all conservative or neutral):
 * - Linear USDT-margined contracts, ISOLATED margin only, one position per symbol.
 * - Fill price = reference price moved against the trader by slippage; fee = notional x taker rate.
 * - Liquidation price (isolated) is derived from the position's CURRENT isolated margin, so funding moves it:
 *   LONG (entry*q - margin) / (q*(1 - mmr)), SHORT (entry*q + margin) / (q*(1 + mmr)). At opening this is about
 *   entry x (1 - 1/leverage + mmr) for a long. Real exchanges add tiered maintenance amounts; this omits them.
 * - Liquidation closes the whole position at its liquidation price and the isolated margin (never below 0) is lost.
 *   When funding drives margin below 0 before a mark update, the excess funding debt appears only in that FUNDING
 *   ledger row and is never charged to the wallet (isolated margin caps the loss); reconciliation must sum FUNDING and
 *   LIQUIDATION rows together rather than read the shortfall as missing P&L.
 * - Funding: payment = quantity x mark x rate; LONG pays a positive rate, SHORT receives it. It moves isolated margin,
 *   recomputes the liquidation price and liquidates at once if the mark has already crossed it.
 * - Ledger ids: order ids may not use the reserved "funding:" and "liq:" prefixes the simulator writes itself.
 */

/** Quantity tolerance shared by the simulator and the futures risk gate so both treat float dust the same way. */
export const PAPER_FUTURES_QUANTITY_EPS = 1e-12;
const EPS = PAPER_FUTURES_QUANTITY_EPS;
const sign = (side: PaperFuturesSide): 1 | -1 => (side === "LONG" ? 1 : -1);
const opposite = (side: PaperFuturesSide): PaperFuturesSide => (side === "LONG" ? "SHORT" : "LONG");

export type PaperFuturesFillResult =
  | Readonly<{ status: "FILLED"; account: PaperFuturesAccount; entry: PaperFuturesLedgerEntry }>
  | Readonly<{ status: "REJECTED"; account: PaperFuturesAccount; reason: string }>;

function finitePositive(value: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function validateCostProfile(costs: PaperFuturesCostProfile): void {
  if (!(costs.takerFeeRate >= 0 && costs.takerFeeRate < 0.01)) throw new Error("PAPER_FUTURES_FEE_RATE_INVALID");
  if (!(costs.slippageBps >= 0 && costs.slippageBps < 500)) throw new Error("PAPER_FUTURES_SLIPPAGE_INVALID");
  if (!(costs.maintenanceMarginRate > 0 && costs.maintenanceMarginRate < 0.1)) throw new Error("PAPER_FUTURES_MMR_INVALID");
}

/** Isolated liquidation price from the position's current margin (see the model notes above). */
export function liquidationPriceFromMargin(side: PaperFuturesSide, entryPrice: number, quantity: number, isolatedMargin: number, maintenanceMarginRate: number): number {
  return side === "LONG"
    ? Math.max(0, (entryPrice * quantity - isolatedMargin) / (quantity * (1 - maintenanceMarginRate)))
    : (entryPrice * quantity + isolatedMargin) / (quantity * (1 + maintenanceMarginRate));
}

/** Liquidation price of a fresh position opened at `entryPrice` with margin notional/leverage. */
export function liquidationPrice(side: PaperFuturesSide, entryPrice: number, leverage: number, maintenanceMarginRate: number): number {
  return liquidationPriceFromMargin(side, entryPrice, 1, entryPrice / leverage, maintenanceMarginRate);
}

const RESERVED_ID = /^(funding|liq):/;

/** Fill price for opening `side` exposure or closing it: always adverse to the trader. */
export function adverseFillPrice(referencePrice: number, exposureSide: PaperFuturesSide, opening: boolean, slippageBps: number): number {
  const buying = opening ? exposureSide === "LONG" : exposureSide === "SHORT";
  const move = slippageBps / 10_000;
  return buying ? referencePrice * (1 + move) : referencePrice * (1 - move);
}

export function emptyPaperFuturesAccount(walletBalance: number): PaperFuturesAccount {
  if (!finitePositive(walletBalance)) throw new Error("PAPER_FUTURES_WALLET_INVALID");
  return Object.freeze({ walletBalance, positions: Object.freeze([]), ledger: Object.freeze([]) });
}

function freezeAccount(walletBalance: number, positions: readonly PaperFuturesPosition[], ledger: readonly PaperFuturesLedgerEntry[]): PaperFuturesAccount {
  return Object.freeze({ walletBalance, positions: Object.freeze([...positions]), ledger: Object.freeze([...ledger]) });
}

function reject(account: PaperFuturesAccount, reason: string): PaperFuturesFillResult {
  return Object.freeze({ status: "REJECTED", account, reason });
}

export function unrealizedPnl(position: PaperFuturesPosition, markPrice: number): number {
  return sign(position.side) * (markPrice - position.entryPrice) * position.quantity;
}

export function accountEquity(account: PaperFuturesAccount, markPrices: Readonly<Record<string, number>>): number {
  return account.walletBalance + account.positions.reduce((sum, p) => {
    const mark = markPrices[p.symbol];
    return sum + p.isolatedMargin + (Number.isFinite(mark) ? unrealizedPnl(p, mark!) : 0);
  }, 0);
}

/**
 * Apply one order at a reference price. Opening adds isolated margin from the wallet; a reduce-only order (or an order
 * opposite to the current position) closes part or all of it. Flipping through zero in one order is rejected.
 */
export function applyOrder(account: PaperFuturesAccount, intent: PaperFuturesOrderIntent, referencePrice: number, at: number, costs: PaperFuturesCostProfile): PaperFuturesFillResult {
  validateCostProfile(costs);
  if (RESERVED_ID.test(intent.id) || intent.id.trim() === "") return reject(account, "PAPER_FUTURES_ORDER_ID_RESERVED");
  if (account.ledger.some((entry) => entry.id === intent.id)) return reject(account, "PAPER_FUTURES_DUPLICATE_ORDER");
  if (!/^[A-Z0-9]{2,20}USDT$/.test(intent.symbol)) return reject(account, "PAPER_FUTURES_SYMBOL_INVALID");
  if (!finitePositive(intent.quantity) || !finitePositive(referencePrice) || !Number.isSafeInteger(at) || at < 0) return reject(account, "PAPER_FUTURES_INPUT_INVALID");
  if (intent.marginMode !== "ISOLATED") return reject(account, "PAPER_FUTURES_MARGIN_MODE_UNSUPPORTED");
  const current = account.positions.find((p) => p.symbol === intent.symbol);
  const others = account.positions.filter((p) => p.symbol !== intent.symbol);
  const reducing = current != null && current.side !== intent.side;

  if (intent.reduceOnly && !reducing) return reject(account, "PAPER_FUTURES_REDUCE_ONLY_WOULD_INCREASE");
  if (reducing) {
    if (intent.quantity > current.quantity + EPS) return reject(account, "PAPER_FUTURES_FLIP_NOT_ALLOWED");
    const price = adverseFillPrice(referencePrice, current.side, false, costs.slippageBps);
    const fee = intent.quantity * price * costs.takerFeeRate;
    const fraction = Math.min(1, intent.quantity / current.quantity);
    const releasedMargin = current.isolatedMargin * fraction;
    const gross = sign(current.side) * (price - current.entryPrice) * intent.quantity;
    const realizedPnl = gross - fee;
    const remaining = current.quantity - intent.quantity;
    const entry: PaperFuturesLedgerEntry = Object.freeze({ id: intent.id, at, symbol: intent.symbol, kind: "CLOSE", side: current.side, quantity: intent.quantity, price, fee, realizedPnl });
    const keptMargin = current.isolatedMargin - releasedMargin;
    const positions = remaining <= EPS ? others : [...others, Object.freeze({ ...current, quantity: remaining, isolatedMargin: keptMargin, liquidationPrice: liquidationPriceFromMargin(current.side, current.entryPrice, remaining, keptMargin, costs.maintenanceMarginRate) })];
    return Object.freeze({ status: "FILLED", account: freezeAccount(account.walletBalance + releasedMargin + realizedPnl, positions, [...account.ledger, entry]), entry });
  }

  if (!Number.isFinite(intent.leverage) || intent.leverage < 1 || intent.leverage > 125) return reject(account, "PAPER_FUTURES_LEVERAGE_INVALID");
  if (current != null && current.leverage !== intent.leverage) return reject(account, "PAPER_FUTURES_LEVERAGE_CHANGE_WITH_POSITION");
  const price = adverseFillPrice(referencePrice, intent.side, true, costs.slippageBps);
  const notional = intent.quantity * price;
  const margin = notional / intent.leverage;
  const fee = notional * costs.takerFeeRate;
  if (margin + fee > account.walletBalance + EPS) return reject(account, "PAPER_FUTURES_INSUFFICIENT_BALANCE");
  const quantity = (current?.quantity ?? 0) + intent.quantity;
  const entryPrice = current == null ? price : (current.entryPrice * current.quantity + price * intent.quantity) / quantity;
  const isolatedMargin = (current?.isolatedMargin ?? 0) + margin;
  const position: PaperFuturesPosition = Object.freeze({
    symbol: intent.symbol, side: intent.side, quantity, entryPrice, leverage: intent.leverage, marginMode: "ISOLATED",
    isolatedMargin,
    liquidationPrice: liquidationPriceFromMargin(intent.side, entryPrice, quantity, isolatedMargin, costs.maintenanceMarginRate),
    openedAt: current?.openedAt ?? at,
  });
  const entry: PaperFuturesLedgerEntry = Object.freeze({ id: intent.id, at, symbol: intent.symbol, kind: "OPEN", side: intent.side, quantity: intent.quantity, price, fee, realizedPnl: 0 });
  return Object.freeze({ status: "FILLED", account: freezeAccount(account.walletBalance - margin - fee, [...others, position], [...account.ledger, entry]), entry });
}

/** Liquidate every isolated position whose mark price reached its liquidation price. */
export function applyMarkPrices(account: PaperFuturesAccount, markPrices: Readonly<Record<string, number>>, at: number): PaperFuturesAccount {
  if (!Number.isSafeInteger(at) || at < 0) throw new Error("PAPER_FUTURES_TIME_INVALID");
  const ledger = [...account.ledger];
  const positions: PaperFuturesPosition[] = [];
  for (const p of account.positions) {
    const mark = markPrices[p.symbol];
    const breached = Number.isFinite(mark) && (p.side === "LONG" ? mark! <= p.liquidationPrice : mark! >= p.liquidationPrice);
    if (!breached) { positions.push(p); continue; }
    let id = `liq:${p.symbol}:${at}`;
    for (let n = 2; ledger.some((entry) => entry.id === id); n += 1) id = `liq:${p.symbol}:${at}:${n}`;
    ledger.push(Object.freeze({ id, at, symbol: p.symbol, kind: "LIQUIDATION", side: p.side, quantity: p.quantity, price: p.liquidationPrice, fee: 0, realizedPnl: -Math.max(0, p.isolatedMargin) }));
  }
  return positions.length === account.positions.length ? account : freezeAccount(account.walletBalance, positions, ledger);
}

/** Settle one funding interval for `symbol`. A positive rate moves LONG margin to SHORT; idempotent per (symbol, fundingTime). */
export function applyFunding(account: PaperFuturesAccount, symbol: string, fundingRate: number, markPrice: number, fundingTime: number, costs: PaperFuturesCostProfile): PaperFuturesAccount {
  validateCostProfile(costs);
  if (!Number.isFinite(fundingRate) || Math.abs(fundingRate) > 0.05 || !finitePositive(markPrice) || !Number.isSafeInteger(fundingTime)) throw new Error("PAPER_FUTURES_FUNDING_INVALID");
  const id = `funding:${symbol}:${fundingTime}`;
  const position = account.positions.find((p) => p.symbol === symbol);
  if (position == null || account.ledger.some((entry) => entry.id === id)) return account;
  const amount = -sign(position.side) * position.quantity * markPrice * fundingRate;
  const isolatedMargin = position.isolatedMargin + amount;
  const updated: PaperFuturesPosition = Object.freeze({ ...position, isolatedMargin, liquidationPrice: liquidationPriceFromMargin(position.side, position.entryPrice, position.quantity, isolatedMargin, costs.maintenanceMarginRate) });
  const entry: PaperFuturesLedgerEntry = Object.freeze({ id, at: fundingTime, symbol, kind: "FUNDING", side: position.side, quantity: position.quantity, price: markPrice, fee: 0, realizedPnl: amount });
  const funded = freezeAccount(account.walletBalance, [...account.positions.filter((p) => p.symbol !== symbol), updated], [...account.ledger, entry]);
  // Funding can move the liquidation price past the current mark: liquidate at once rather than carry negative margin.
  return applyMarkPrices(funded, { [symbol]: markPrice }, fundingTime);
}

export { opposite as oppositeFuturesSide };
