"use strict";
/**
 * Evidence Run #1 -- headless drive of the REAL Paper Trading core at PR #1 HEAD.
 *
 * WHAT THIS IS: it constructs the same PaperBroker / ControlPlane / StrategyEngine /
 * DesktopPersistenceStore / RuntimeCommandService objects, with the same constants, that
 * apps/desktop/src/main.ts constructs -- and drives them with REAL live Upbit public
 * market prices. Every order, fill, fee, PnL number and DB row it produces is computed by
 * the repository's own code, not by this script.
 *
 * WHAT THIS IS NOT: it is NOT an operator session of the Electron desktop app. There is no
 * Electron process, no BrowserWindow, no IPC, no renderer, and no human at a GUI. This
 * container has no DISPLAY and cannot install electron (blocked @electron/node-gyp git
 * dependency). Therefore this run CANNOT satisfy the "Observed sessions" evidence row,
 * which counts real app sessions. See EVIDENCE-RUN-1.md for the row-by-row verdict.
 *
 * Paper-only: no credentials are read, no private endpoint is called, no order leaves this
 * process. The only network call is the Upbit PUBLIC ticker endpoint.
 */
const fs = require("node:fs");
const path = require("node:path");

const D = path.join(__dirname, "..", "dist", "apps", "desktop", "src");
const { PaperBroker } = require(path.join(D, "paperBroker.js"));
const { ControlPlane } = require(path.join(D, "controlPlane.js"));
const { StrategyEngine, SmaCrossoverStrategy } = require(path.join(D, "strategyEngine.js"));
const { DesktopPersistenceStore } = require(path.join(D, "desktopPersistenceStore.js"));
const { RuntimeCommandService } = require(path.join(D, "runtimeCommandService.js"));

// Mirrored verbatim from apps/desktop/src/main.ts (lines 22-43, 280-281).
const INITIAL_CASH = 10_000_000;
const FEE_RATE = 0.0005;
const MARKET = "KRW-BTC";
const RISK_POLICY = { maxOrderNotional: 2_000_000, maxPositionQuantity: 0.1, maxRealizedLoss: 1_000_000, minOrderNotional: 5_000 };
const FILL_MODEL = { slippageBps: 5, spreadBps: 5, maxFillRatio: 0.9 };

const log = [];
function record(step, detail) {
  const entry = { at: new Date().toISOString(), step, ...detail };
  log.push(entry);
  console.log(`[${entry.at}] ${step}: ${JSON.stringify(detail)}`);
}

async function livePrice() {
  const res = await fetch(`https://api.upbit.com/v1/ticker?markets=${MARKET}`);
  if (!res.ok) throw new Error(`Upbit public ticker HTTP ${res.status}`);
  const [t] = await res.json();
  return { price: t.trade_price, serverTimestamp: t.trade_timestamp };
}

function build(dbPath) {
  const store = new DesktopPersistenceStore(dbPath);
  const restored = store.load();
  const broker = new PaperBroker(INITIAL_CASH, MARKET, FEE_RATE, RISK_POLICY, restored?.paper, FILL_MODEL);
  const control = new ControlPlane("sma-crossover", 200, restored?.control);
  const strategy = new StrategyEngine(new SmaCrossoverStrategy(5, 20));
  const runtime = new RuntimeCommandService(broker, control, strategy, {
    save: (paper, controlState) => store.save(paper, controlState)
  });
  return { store, broker, control, strategy, runtime, restored };
}

async function main() {
  const dbPath = path.join(__dirname, "session-1.db");
  fs.rmSync(dbPath, { force: true });
  fs.rmSync(`${dbPath}-shm`, { force: true });
  fs.rmSync(`${dbPath}-wal`, { force: true });

  // ---- STEP 1: cold start ----
  let ctx = build(dbPath);
  record("STEP1_COLD_START", {
    dbPath,
    restoredFromDisk: ctx.restored != null,
    autoTradeEnabled: ctx.control.snapshot().autoTradeEnabled,
    status: ctx.control.snapshot().status
  });
  if (ctx.control.snapshot().autoTradeEnabled !== false) throw new Error("FAIL: auto-trade default was not OFF");
  record("STEP2_AUTOTRADE_DEFAULT_OFF", { verdict: "PASS", autoTradeEnabled: false });

  // ---- STEP 3: real live public market data ----
  const m1 = await livePrice();
  record("STEP3_LIVE_UPBIT_PUBLIC_PRICE", { market: MARKET, price: m1.price, upbitTradeTimestamp: m1.serverTimestamp });

  // ---- STEP 4: start session + two real manual paper orders ----
  ctx.runtime.start();
  record("STEP4_SESSION_STARTED", { status: ctx.control.snapshot().status });

  const buy = ctx.runtime.manualOrder("BUY", 0.001, m1.price);
  record("STEP5_MANUAL_ORDER_1_BUY", {
    id: buy.id, side: buy.side, requestedQuantity: buy.requestedQuantity, filledQuantity: buy.quantity,
    quotedPrice: buy.quotedPrice, fillPrice: buy.price, fee: buy.fee, filledAt: buy.filledAt
  });

  const m2 = await livePrice();
  const sell = ctx.runtime.manualOrder("SELL", 0.0005, m2.price);
  record("STEP6_MANUAL_ORDER_2_SELL", {
    id: sell.id, side: sell.side, requestedQuantity: sell.requestedQuantity, filledQuantity: sell.quantity,
    quotedPrice: sell.quotedPrice, fillPrice: sell.price, fee: sell.fee, filledAt: sell.filledAt
  });

  const before = ctx.broker.snapshot(m2.price);
  record("STEP7_PORTFOLIO_AFTER_ORDERS", {
    cash: before.cash, equity: before.equity, unrealizedPnl: before.unrealizedPnl,
    positionQuantity: before.position.quantity, positionAvgPrice: before.position.averagePrice,
    realizedPnl: before.position.realizedPnl, orderCount: before.orders.length
  });
  if (before.orders.length !== 2) throw new Error(`FAIL: expected 2 completed orders, got ${before.orders.length}`);

  // ---- STEP 8: simulate app quit ----
  ctx.store.close();
  record("STEP8_APP_QUIT", { note: "persistence store closed; process state discarded" });

  // ---- STEP 9: restart + recovery ----
  ctx = build(dbPath);
  const after = ctx.broker.snapshot(m2.price);
  const recovered =
    ctx.restored != null &&
    after.orders.length === before.orders.length &&
    after.position.quantity === before.position.quantity &&
    after.position.averagePrice === before.position.averagePrice &&
    after.position.realizedPnl === before.position.realizedPnl &&
    after.cash === before.cash;
  record("STEP9_RESTART_RECOVERY", {
    verdict: recovered ? "PASS" : "FAIL",
    restoredFromDisk: ctx.restored != null,
    cash: after.cash, positionQuantity: after.position.quantity,
    positionAvgPrice: after.position.averagePrice, realizedPnl: after.position.realizedPnl,
    orderCount: after.orders.length,
    statusAfterRestart: ctx.control.snapshot().status,
    autoTradeAfterRestart: ctx.control.snapshot().autoTradeEnabled
  });
  if (!recovered) throw new Error("FAIL: restart recovery mismatch");

  // ---- STEP 10: Kill Switch ----
  ctx.runtime.start();
  ctx.runtime.setAutoTrade(true);
  record("STEP10A_AUTOTRADE_ARMED", { canAutoTrade: ctx.control.canAutoTrade() });
  if (ctx.control.canAutoTrade() !== true) throw new Error("FAIL: could not arm auto-trade for kill-switch test");

  ctx.runtime.stop();
  const killed = ctx.control.snapshot();
  record("STEP10B_KILL_SWITCH_ENGAGED", {
    verdict: killed.status === "STOPPED" && killed.autoTradeEnabled === false ? "PASS" : "FAIL",
    status: killed.status, autoTradeEnabled: killed.autoTradeEnabled, canAutoTrade: ctx.control.canAutoTrade()
  });

  // ---- STEP 11: orders blocked after kill switch ----
  const m3 = await livePrice();
  const blocked = ctx.runtime.automaticSignal(MARKET, m3.price, ctx.broker.snapshot(m3.price).position.quantity, {
    type: "BUY", reason: "evidence-run-1 post-kill-switch probe", confidence: 1, timestamp: Date.now()
  });
  const ordersAfter = ctx.broker.snapshot(m3.price).orders.length;
  record("STEP11_ORDER_BLOCKED_AFTER_KILL_SWITCH", {
    verdict: blocked.outcome === "SKIPPED" && ordersAfter === 2 ? "PASS" : "FAIL",
    automaticSignalOutcome: blocked.outcome, orderCountUnchanged: ordersAfter === 2, orderCount: ordersAfter
  });

  // ---- STEP 12: market data re-fetch after kill switch (public REST only) ----
  record("STEP12_MARKET_DATA_REFETCH", {
    verdict: m3.price > 0 ? "PASS" : "FAIL",
    note: "public REST ticker re-fetched successfully after kill switch",
    price: m3.price, upbitTradeTimestamp: m3.serverTimestamp
  });

  ctx.store.close();

  fs.writeFileSync(path.join(__dirname, "session-1-log.json"), JSON.stringify(log, null, 2));
  console.log("\nSESSION COMPLETE -- artifacts written");
}

main().catch((e) => {
  record("FATAL", { message: e.message });
  fs.writeFileSync(path.join(__dirname, "session-1-log.json"), JSON.stringify(log, null, 2));
  console.error(e);
  process.exit(1);
});
