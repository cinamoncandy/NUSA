"use strict";
/**
 * Independent Paper ledger verifier. Re-derives cash, position quantity, average entry
 * price, realized PnL, and total fees purely from an order list and an initial cash
 * figure -- using its own arithmetic, not PaperBroker's. The whole point is catching a
 * bug in PaperBroker's average-price/PnL/fee formulas by NOT calling the same code that
 * might contain that bug; a verifier that imports and reuses PaperBroker's own helpers
 * would only prove the code agrees with itself.
 *
 * Node built-ins only. Pure functions, no I/O, no mutation of inputs.
 */

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * @param {ReadonlyArray<{id:string,side:"BUY"|"SELL",quantity:number,price:number,fee:number,filledAt:string}>} orders
 *   Orders in ANY order -- sorted internally by filledAt before replay, since
 *   PaperBroker.exportState() stores newest-first (unshift).
 * @param {number} initialCash
 * @returns {{errors: string[], cash: number, quantity: number, averagePrice: number, realizedPnl: number, totalFees: number, orderCount: number}}
 */
function verifyPaperLedger(orders, initialCash) {
  const errors = [];
  if (!isFiniteNumber(initialCash) || initialCash < 0) errors.push(`initialCash must be a finite non-negative number, got ${initialCash}`);

  const seenOrderIds = new Set();
  for (const order of orders) {
    if (!order || typeof order.id !== "string" || order.id.length === 0) { errors.push("order is missing a non-empty id"); continue; }
    if (seenOrderIds.has(order.id)) errors.push(`duplicate order id: ${order.id}`);
    seenOrderIds.add(order.id);
    if (order.side !== "BUY" && order.side !== "SELL") errors.push(`order ${order.id}: invalid side ${order.side}`);
    if (!isFiniteNumber(order.quantity) || order.quantity <= 0) errors.push(`order ${order.id}: quantity must be a positive finite number, got ${order.quantity}`);
    if (!isFiniteNumber(order.price) || order.price <= 0) errors.push(`order ${order.id}: price must be a positive finite number, got ${order.price}`);
    if (!isFiniteNumber(order.fee) || order.fee < 0) errors.push(`order ${order.id}: fee must be a finite non-negative number, got ${order.fee}`);
    if (typeof order.filledAt !== "string" || Number.isNaN(Date.parse(order.filledAt))) errors.push(`order ${order.id}: filledAt must be a parseable timestamp`);
  }
  if (errors.length > 0) return { errors, cash: NaN, quantity: NaN, averagePrice: NaN, realizedPnl: NaN, totalFees: NaN, orderCount: orders.length };

  // Stable sort: ties (orders sharing the same millisecond-resolution filledAt, which a
  // fast synchronous scenario replay can easily produce) preserve the input array's
  // existing relative order rather than being reordered arbitrarily. Callers whose input
  // isn't already chronological for tied entries should pre-sort by a finer-grained key.
  const chronological = [...orders].sort((a, b) => Date.parse(a.filledAt) - Date.parse(b.filledAt));

  let cash = initialCash;
  let quantity = 0;
  let averagePrice = 0;
  let realizedPnl = 0;
  let totalFees = 0;

  for (const order of chronological) {
    totalFees += order.fee;
    const notional = order.quantity * order.price;
    if (order.side === "BUY") {
      const previousCost = quantity * averagePrice;
      cash -= notional + order.fee;
      quantity += order.quantity;
      averagePrice = quantity === 0 ? 0 : (previousCost + notional) / quantity;
      if (cash < -1e-6) errors.push(`order ${order.id}: cash went negative (${cash}) after a BUY -- independent verifier disagrees with a non-negative-cash invariant`);
    } else {
      if (order.quantity - quantity > 1e-9) errors.push(`order ${order.id}: SELL quantity (${order.quantity}) exceeds independently-tracked position (${quantity})`);
      const sellQuantity = Math.min(order.quantity, quantity);
      realizedPnl += (order.price - averagePrice) * sellQuantity - order.fee;
      cash += sellQuantity * order.price - order.fee;
      quantity -= sellQuantity;
      if (quantity <= 1e-9) { quantity = 0; averagePrice = 0; }
    }
  }

  return { errors, cash, quantity, averagePrice, realizedPnl, totalFees, orderCount: orders.length };
}

module.exports = { verifyPaperLedger };
