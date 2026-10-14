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
 * - Liquidation price (isolated): LONG entry x (1 - 1/leverage + mmr), SHORT entry x (1 + 1/leverage - mmr).
 *   Real exchanges add tiered maintenance amounts; this omits them, which can only make the simulated liquidation
 *   later than reality for large notionals, so the risk gate's distance floor (25%) is kept far above it.
 * - Liquidation closes the whole position at its liquidation price and the isolated margin is lost.
 * - Funding: payment = quantity x mark x rate; LONG pays a positive rate, SHORT receives it. It moves isolated margin.
 */

const EPS = 1e-12;
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

export function liquidationPrice(side: PaperFuturesSide, entryPrice: number, leverage: number, maintenanceMarginRate: number): number {
  return side === "LONG"
    ? entryPrice * (1 - 1 / leverage + maintenanceMarginRate)
    : entryPrice * (1 + 1 / leverage - maintenanceMarginRate);
}

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
    const positions = remaining <= EPS ? others : [...others, Object.freeze({ ...current, quantity: remaining, isolatedMargin: current.isolatedMargin - releasedMargin })];
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
  const position: PaperFuturesPosition = Object.freeze({
    symbol: intent.symbol, side: intent.side, quantity, entryPrice, leverage: intent.leverage, marginMode: "ISOLATED",
    isolatedMargin: (current?.isolatedMargin ?? 0) + margin,
    liquidationPrice: liquidationPrice(intent.side, entryPrice, intent.leverage, costs.maintenanceMarginRate),
    openedAt: current?.openedAt ?? at,
  });
  const entry: PaperFuturesLedgerEntry = Object.freeze({ id: intent.id, at, symbol: intent.symbol, kind: "OPEN", side: intent.side, quantity: intent.quantity, price, fee, realizedPnl: 0 });
  return Object.freeze({ status: "FILLED", account: freezeAccount(account.walletBalance - margin - fee, [...others, position], [...account.ledger, entry]), entry });
}

/** Liquidate every isolated position whose mark price reached its liquidation price. */
export function applyMarkPrices(account: PaperFuturesAccount, markPrices: Readonly<Record<string, number>>, at: number): PaperFuturesAccount {
  const ledger = [...account.ledger];
  const positions: PaperFuturesPosition[] = [];
  for (const p of account.positions) {
    const mark = markPrices[p.symbol];
    const breached = Number.isFinite(mark) && (p.side === "LONG" ? mark! <= p.liquidationPrice : mark! >= p.liquidationPrice);
    if (!breached) { positions.push(p); continue; }
    ledger.push(Object.freeze({ id: `liq:${p.symbol}:${at}`, at, symbol: p.symbol, kind: "LIQUIDATION", side: p.side, quantity: p.quantity, price: p.liquidationPrice, fee: 0, realizedPnl: -p.isolatedMargin }));
  }
  return positions.length === account.positions.length ? account : freezeAccount(account.walletBalance, positions, ledger);
}

/** Settle one funding interval for `symbol`. A positive rate moves LONG margin to SHORT; idempotent per (symbol, fundingTime). */
export function applyFunding(account: PaperFuturesAccount, symbol: string, fundingRate: number, markPrice: number, fundingTime: number): PaperFuturesAccount {
  if (!Number.isFinite(fundingRate) || Math.abs(fundingRate) > 0.05 || !finitePositive(markPrice) || !Number.isSafeInteger(fundingTime)) throw new Error("PAPER_FUTURES_FUNDING_INVALID");
  const id = `funding:${symbol}:${fundingTime}`;
  const position = account.positions.find((p) => p.symbol === symbol);
  if (position == null || account.ledger.some((entry) => entry.id === id)) return account;
  const amount = -sign(position.side) * position.quantity * markPrice * fundingRate;
  const updated: PaperFuturesPosition = Object.freeze({ ...position, isolatedMargin: position.isolatedMargin + amount });
  const entry: PaperFuturesLedgerEntry = Object.freeze({ id, at: fundingTime, symbol, kind: "FUNDING", side: position.side, quantity: position.quantity, price: markPrice, fee: 0, realizedPnl: amount });
  return freezeAccount(account.walletBalance, [...account.positions.filter((p) => p.symbol !== symbol), updated], [...account.ledger, entry]);
}

export { opposite as oppositeFuturesSide };
