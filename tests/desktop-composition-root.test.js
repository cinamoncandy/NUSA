const test = require("node:test");
const assert = require("node:assert/strict");

const { ControlPlane } = require("../dist/apps/desktop/src/controlPlane.js");
const { DesktopCompositionRoot } = require("../dist/apps/desktop/src/desktopCompositionRoot.js");
const { PaperBroker } = require("../dist/apps/desktop/src/paperBroker.js");
const { PERSISTENCE_REPAIR_MESSAGE, RuntimeCommandService } = require("../dist/apps/desktop/src/runtimeCommandService.js");
const { SmaCrossoverStrategy, StrategyEngine } = require("../dist/apps/desktop/src/strategyEngine.js");

function createCommands() {
  return new RuntimeCommandService(
    new PaperBroker(1_000_000, "KRW-BTC", 0),
    new ControlPlane("sma-crossover"),
    new StrategyEngine(new SmaCrossoverStrategy(2, 3)),
    { save() {} },
    { evaluate: () => ({ status: "ALLOW", reasonCodes: [] }) }
  );
}

test("DesktopCompositionRoot defers monitor and Paper runtime work until start, then fails closed after stop", async () => {
  const commands = createCommands();
  let monitorStarts = 0;
  let monitorStops = 0;
  const root = new DesktopCompositionRoot({
    commands,
    getMonitorOptions: () => ({ port: 41731, getStatus: () => ({ app: "NUSA", mode: "PAPER", marketConnectionState: "WARMING_UP", warmupState: "WARMING_UP", stale: false, observedAt: new Date().toISOString() }), getAccount: () => ({ available: false, reason: "MARKET_DATA_UNAVAILABLE" }), getOpenOrderCount: () => 0, getEvents: () => [] }),
    monitorStarter: () => { monitorStarts += 1; return { port: 41731, stop: async () => { monitorStops += 1; } }; }
  });

  assert.equal(root.isRuntimeStarted(), false);
  assert.equal(monitorStarts, 0);
  assert.throws(() => root.commandService(), /Service not registered/);
  await Promise.all([root.startRuntime(), root.startRuntime(), root.startRuntime()]);
  assert.equal(root.isRuntimeStarted(), true);
  assert.equal(monitorStarts, 0);

  const monitor = root.startMonitor();
  assert.equal(monitor.port, 41731);
  assert.equal(root.startMonitor(), monitor);
  assert.equal(monitorStarts, 1);

  await Promise.all([root.stopRuntime(), root.stopRuntime(), root.stopRuntime()]);
  assert.equal(root.isRuntimeStarted(), false);
  assert.equal(commands.isAvailable(), false);
  assert.throws(() => root.commandService().manualOrder("BUY", 0.01, 100), new RegExp(PERSISTENCE_REPAIR_MESSAGE));
  await root.stopMonitor();
  await root.stopMonitor();
  assert.equal(monitorStops, 1);
});
