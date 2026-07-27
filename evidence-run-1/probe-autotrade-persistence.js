"use strict";
/**
 * Focused safety probe raised by Evidence Run #1 STEP9: the ControlPlane restored to
 * status=RUNNING after a restart. That is only safe if autoTradeEnabled can NEVER come back
 * armed. This probe arms auto-trade, persists, then reloads from the same DB and reports the
 * restored flags -- using the repository's own ControlPlane/persistence code.
 *
 * Paper-only, no network, no credentials.
 */
const fs = require("node:fs");
const path = require("node:path");
const D = path.join(__dirname, "..", "dist", "apps", "desktop", "src");
const { PaperBroker } = require(path.join(D, "paperBroker.js"));
const { ControlPlane } = require(path.join(D, "controlPlane.js"));
const { StrategyEngine, SmaCrossoverStrategy } = require(path.join(D, "strategyEngine.js"));
const { DesktopPersistenceStore } = require(path.join(D, "desktopPersistenceStore.js"));
const { RuntimeCommandService } = require(path.join(D, "runtimeCommandService.js"));

const INITIAL_CASH = 10_000_000, FEE_RATE = 0.0005, MARKET = "KRW-BTC";
const RISK_POLICY = { maxOrderNotional: 2_000_000, maxPositionQuantity: 0.1, maxRealizedLoss: 1_000_000, minOrderNotional: 5_000 };
const FILL_MODEL = { slippageBps: 5, spreadBps: 5, maxFillRatio: 0.9 };

const dbPath = path.join(__dirname, "probe-autotrade.db");
for (const s of ["", "-shm", "-wal"]) fs.rmSync(`${dbPath}${s}`, { force: true });

function build() {
  const store = new DesktopPersistenceStore(dbPath);
  const restored = store.load();
  const broker = new PaperBroker(INITIAL_CASH, MARKET, FEE_RATE, RISK_POLICY, restored?.paper, FILL_MODEL);
  const control = new ControlPlane("sma-crossover", 200, restored?.control);
  const strategy = new StrategyEngine(new SmaCrossoverStrategy(5, 20));
  const runtime = new RuntimeCommandService(broker, control, strategy, { save: (p, c) => store.save(p, c) });
  return { store, control, runtime, restored };
}

// Session A: arm auto-trade and leave it armed (simulating a crash while auto-trading).
let ctx = build();
ctx.runtime.start();
ctx.runtime.setAutoTrade(true);
const armed = ctx.control.snapshot();
console.log("SESSION_A_BEFORE_CRASH:", JSON.stringify({
  status: armed.status, autoTradeEnabled: armed.autoTradeEnabled, canAutoTrade: ctx.control.canAutoTrade()
}));
ctx.store.close(); // abrupt end, no explicit stop()

// Session B: reload from the same DB.
ctx = build();
const restored = ctx.control.snapshot();
const result = {
  status: restored.status,
  autoTradeEnabled: restored.autoTradeEnabled,
  canAutoTrade: ctx.control.canAutoTrade()
};
console.log("SESSION_B_AFTER_RESTART:", JSON.stringify(result));
console.log(result.canAutoTrade === false
  ? "VERDICT: PASS -- auto-trade cannot resume automatically across a restart"
  : "VERDICT: FAIL -- auto-trade RESUMED ARMED across a restart (safety issue)");
ctx.store.close();

fs.writeFileSync(path.join(__dirname, "probe-autotrade-result.json"), JSON.stringify({
  probe: "auto-trade must not survive a restart armed",
  sessionA: { status: armed.status, autoTradeEnabled: armed.autoTradeEnabled },
  sessionB: result,
  verdict: result.canAutoTrade === false ? "PASS" : "FAIL"
}, null, 2));
