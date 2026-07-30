const test = require("node:test");
const assert = require("node:assert/strict");
const { DependencyContainer, EngineRegistry, PluginRegistry } = require("../dist/apps/cloud/src/engineRegistry.js");

test("dependency container is explicit and rejects duplicate keys", () => {
  const container = new DependencyContainer();
  container.set("clock", { now: () => 1 });
  assert.equal(container.has("clock"), true);
  assert.throws(() => container.set("clock", {}), /already registered/);
  assert.throws(() => container.get("missing"), /not found/);
});

test("engine and plugin registries validate immutable versioned definitions", () => {
  const engines = new EngineRegistry();
  const engine = engines.register({ engineId: "paper-analysis", version: "1.0.0", lifecycle: "ACTIVE", capabilities: ["READ_MARKET"] });
  assert.equal(Object.isFrozen(engine), true);
  assert.throws(() => engines.register({ ...engine }), /already registered/);
  const plugins = new PluginRegistry();
  const plugin = plugins.register({ pluginId: "sma", version: "1.0.0", engineIds: ["paper-analysis"] }, engines);
  assert.equal(Object.isFrozen(plugin), true);
  assert.throws(() => plugins.register({ pluginId: "bad", version: "1.0.0", engineIds: ["unknown"] }, engines), /not found/);
});
