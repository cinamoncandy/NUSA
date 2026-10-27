import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PaperFuturesCostProfile, PaperFuturesOrderIntent } from "../../../../packages/contracts/src/paperFutures";
import { accountEquity, applyFunding, applyMarkPrices, applyOrder, emptyPaperFuturesAccount, liquidationPrice } from "./paperFuturesSimulator";

const COSTS: PaperFuturesCostProfile = Object.freeze({ takerFeeRate: 0.0005, slippageBps: 0, maintenanceMarginRate: 0.004 });
const T0 = Date.UTC(2026, 9, 14, 3, 0, 0);
const order = (id: string, side: "LONG" | "SHORT", quantity: number, extra: Partial<PaperFuturesOrderIntent> = {}): PaperFuturesOrderIntent =>
  Object.freeze({ id, symbol: "BTCUSDT", side, quantity, leverage: 2, marginMode: "ISOLATED", reduceOnly: false, ...extra });
const filled = (result: ReturnType<typeof applyOrder>) => { assert.equal(result.status, "FILLED", result.status === "REJECTED" ? result.reason : ""); return result.account; };

describe("PAPER futures simulator", () => {
  it("opens isolated margin, charges the taker fee and computes the isolated liquidation price", () => {
    const account = filled(applyOrder(emptyPaperFuturesAccount(10_000), order("o1", "LONG", 0.1), 60_000, T0, COSTS));
    const p = account.positions[0]!;
    assert.equal(p.isolatedMargin, 3_000);
    assert.equal(account.walletBalance, 10_000 - 3_000 - 3);
    assert.ok(Math.abs(p.liquidationPrice - 30_000 / 0.996) < 1e-6, "LONG (entry*q - margin) / (q*(1-mmr))");
    assert.ok(Math.abs(liquidationPrice("SHORT", 60_000, 2, 0.004) - 90_000 / 1.004) < 1e-6);
  });

  it("a short profits when price falls; closing returns margin plus P&L after the closing fee", () => {
    const opened = filled(applyOrder(emptyPaperFuturesAccount(10_000), order("o1", "SHORT", 0.1), 60_000, T0, COSTS));
    const closed = applyOrder(opened, order("c1", "LONG", 0.1, { reduceOnly: true }), 54_000, T0 + 1, COSTS);
    assert.equal(closed.status, "FILLED");
    if (closed.status !== "FILLED") return;
    assert.equal(closed.entry.realizedPnl, 600 - 5400 * 0.0005);
    assert.equal(closed.account.positions.length, 0);
    assert.ok(Math.abs(closed.account.walletBalance - (10_000 - 3 + 600 - 2.7)) < 1e-9);
  });

  it("partial close releases a proportional share of margin", () => {
    const opened = filled(applyOrder(emptyPaperFuturesAccount(10_000), order("o1", "LONG", 0.2), 50_000, T0, COSTS));
    const half = filled(applyOrder(opened, order("c1", "SHORT", 0.1, { reduceOnly: true }), 50_000, T0 + 1, COSTS));
    assert.equal(half.positions[0]!.quantity, 0.1);
    assert.equal(half.positions[0]!.isolatedMargin, 2_500);
  });

  it("rejects duplicates, reduce-only increases, flips, leverage changes and unaffordable orders", () => {
    const opened = filled(applyOrder(emptyPaperFuturesAccount(10_000), order("o1", "LONG", 0.1), 60_000, T0, COSTS));
    const reason = (r: ReturnType<typeof applyOrder>) => (r.status === "REJECTED" ? r.reason : "FILLED");
    assert.equal(reason(applyOrder(opened, order("o1", "LONG", 0.1), 60_000, T0, COSTS)), "PAPER_FUTURES_DUPLICATE_ORDER");
    assert.equal(reason(applyOrder(opened, order("o2", "LONG", 0.1, { reduceOnly: true }), 60_000, T0, COSTS)), "PAPER_FUTURES_REDUCE_ONLY_WOULD_INCREASE");
    assert.equal(reason(applyOrder(opened, order("o3", "SHORT", 0.2), 60_000, T0, COSTS)), "PAPER_FUTURES_FLIP_NOT_ALLOWED");
    assert.equal(reason(applyOrder(opened, order("o4", "LONG", 0.1, { leverage: 1 }), 60_000, T0, COSTS)), "PAPER_FUTURES_LEVERAGE_CHANGE_WITH_POSITION");
    assert.equal(reason(applyOrder(emptyPaperFuturesAccount(100), order("o5", "LONG", 1), 60_000, T0, COSTS)), "PAPER_FUTURES_INSUFFICIENT_BALANCE");
  });

  it("liquidates at the liquidation price and loses exactly the isolated margin", () => {
    const opened = filled(applyOrder(emptyPaperFuturesAccount(10_000), order("o1", "LONG", 0.1), 60_000, T0, COSTS));
    const liq = opened.positions[0]!.liquidationPrice;
    assert.equal(applyMarkPrices(opened, { BTCUSDT: liq + 1 }, T0 + 1), opened, "untouched above the line");
    const after = applyMarkPrices(opened, { BTCUSDT: liq }, T0 + 2);
    assert.equal(after.positions.length, 0);
    assert.equal(after.ledger.at(-1)!.kind, "LIQUIDATION");
    assert.equal(after.ledger.at(-1)!.realizedPnl, -3_000);
    assert.equal(after.walletBalance, opened.walletBalance);
  });

  it("funding moves margin from longs to shorts on a positive rate and is applied once per interval", () => {
    const opened = filled(applyOrder(emptyPaperFuturesAccount(10_000), order("o1", "LONG", 0.1), 60_000, T0, COSTS));
    const funded = applyFunding(opened, "BTCUSDT", 0.0001, 60_000, T0 + 8 * 3_600_000, COSTS);
    assert.ok(Math.abs(funded.positions[0]!.isolatedMargin - (3_000 - 0.6)) < 1e-9);
    assert.equal(applyFunding(funded, "BTCUSDT", 0.0001, 60_000, T0 + 8 * 3_600_000, COSTS), funded);
    assert.throws(() => applyFunding(opened, "BTCUSDT", 0.2, 60_000, T0, COSTS), /PAPER_FUTURES_FUNDING_INVALID/);
  });

  it("is pure: the input account is never mutated, and equity adds unrealized P&L", () => {
    const start = emptyPaperFuturesAccount(10_000);
    const opened = filled(applyOrder(start, order("o1", "LONG", 0.1), 60_000, T0, COSTS));
    assert.equal(start.positions.length, 0);
    assert.ok(Object.isFrozen(opened) && Object.isFrozen(opened.positions[0]));
    assert.ok(Math.abs(accountEquity(opened, { BTCUSDT: 61_000 }) - (10_000 - 3 + 100)) < 1e-9);
  });

  it("funding that eats margin moves the liquidation price and liquidates instead of carrying negative margin", () => {
    let account = filled(applyOrder(emptyPaperFuturesAccount(1_000), order("o1", "LONG", 1), 100, T0, { ...COSTS, takerFeeRate: 0 }));
    const startLiq = account.positions[0]!.liquidationPrice;
    for (let i = 1; i <= 12 && account.positions.length > 0; i += 1) account = applyFunding(account, "BTCUSDT", 0.05, 100, T0 + i, COSTS);
    assert.equal(account.positions.length, 0, "liquidated once funding pushed the line past the mark");
    const liq = account.ledger.at(-1)!;
    assert.equal(liq.kind, "LIQUIDATION");
    assert.ok(liq.realizedPnl <= 0, "a liquidation never books a gain");
    assert.ok(account.walletBalance >= 1_000 - 50 - 1e-9, "never loses more than the isolated margin plus funding paid from it");
    const once = applyFunding(filled(applyOrder(emptyPaperFuturesAccount(1_000), order("o2", "LONG", 1), 100, T0, COSTS)), "BTCUSDT", 0.01, 100, T0 + 1, COSTS);
    assert.ok(once.positions[0]!.liquidationPrice > startLiq, "paid funding raises a long's liquidation price");
  });

  it("order ids cannot use the reserved funding/liq prefixes, and repeated liquidations get distinct ids", () => {
    const r = applyOrder(emptyPaperFuturesAccount(10_000), order("funding:BTCUSDT:5", "LONG", 0.1), 60_000, T0, COSTS);
    assert.equal(r.status === "REJECTED" ? r.reason : "", "PAPER_FUTURES_ORDER_ID_RESERVED");
    let account = filled(applyOrder(emptyPaperFuturesAccount(10_000), order("a", "LONG", 0.01), 60_000, T0, COSTS));
    account = applyMarkPrices(account, { BTCUSDT: 1 }, T0 + 1);
    account = filled(applyOrder(account, order("b", "LONG", 0.01), 60_000, T0 + 1, COSTS));
    account = applyMarkPrices(account, { BTCUSDT: 1 }, T0 + 1);
    const ids = account.ledger.filter((e) => e.kind === "LIQUIDATION").map((e) => e.id);
    assert.equal(new Set(ids).size, 2);
    assert.throws(() => applyMarkPrices(account, {}, Number.NaN), /PAPER_FUTURES_TIME_INVALID/);
  });
});
