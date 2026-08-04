const test = require("node:test");
const assert = require("node:assert/strict");

const { ControlPlane } = require("../dist/apps/desktop/src/controlPlane.js");
const { PaperBroker } = require("../dist/apps/desktop/src/paperBroker.js");
const { PaperRuntimeIntegration, PAPER_COMMAND_RUNTIME_SERVICE, createPaperCommandEngine } = require("../dist/apps/desktop/src/paperRuntimeIntegration.js");
const { RuntimeCompositionRoot } = require("../dist/packages/core/src/runtimeCompositionRoot.js");
const { RuntimeCommandService, PERSISTENCE_REPAIR_MESSAGE } = require("../dist/apps/desktop/src/runtimeCommandService.js");
const { SmaCrossoverStrategy, StrategyEngine } = require("../dist/apps/desktop/src/strategyEngine.js");

function harness() {
  const broker = new PaperBroker(1_000_000, "KRW-BTC", 0);
  const control = new ControlPlane("sma-crossover");
  const strategy = new StrategyEngine(new SmaCrossoverStrategy(2, 3));
  const commands = new RuntimeCommandService(
    broker,
    control,
    strategy,
    { save() {} },
    { evaluate: () => ({ status: "ALLOW", reasonCodes: [] }) }
  );
  return { broker, strategy, commands };
}

test("Core Runtime owns the Paper command lifecycle without changing pre-shutdown execution", async () => {
  const h = harness();
  const root = new RuntimeCompositionRoot([createPaperCommandEngine(h.commands)]);
  const integration = new PaperRuntimeIntegration(root);

  await root.start();
  assert.equal(integration.isStarted(), true);
  assert.strictEqual(integration.commandService(), h.commands);
  assert.equal(PAPER_COMMAND_RUNTIME_SERVICE, "desktop.paper-command");

  const manual = integration.commandService().manualOrder("BUY", 0.01, 100);
  assert.equal(manual.side, "BUY");
  h.commands.start();
  h.commands.setAutoTrade(true);
  assert.equal(
    integration.commandService().automaticSignal("KRW-BTC", 100, 0.01, { type: "BUY", reason: "crossover", confidence: 1, timestamp: 1 }).outcome,
    "FILLED"
  );

  const beforeStop = h.broker.exportState();
  await root.stop();

  assert.equal(integration.isStarted(), false);
  assert.equal(h.commands.isAvailable(), false);
  assert.equal(h.strategy.isRunning(), false);
  assert.throws(() => integration.commandService().manualOrder("BUY", 0.01, 100), new RegExp(PERSISTENCE_REPAIR_MESSAGE));
  assert.equal(
    integration.commandService().automaticSignal("KRW-BTC", 100, 0.02, { type: "BUY", reason: "crossover", confidence: 1, timestamp: 2 }).outcome,
    "SKIPPED"
  );
  assert.deepEqual(h.broker.exportState(), beforeStop);
});
