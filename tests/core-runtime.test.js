const test = require("node:test");
const assert = require("node:assert/strict");

const {
  EventBus,
  EngineRegistry,
  NusaRuntime,
} = require("../dist/packages/core/src");

test("EventBus publishes serially and supports once subscriptions", async () => {
  const bus = new EventBus();
  const calls = [];
  bus.subscribe("tick", async (payload) => calls.push(`a:${payload}`));
  bus.once("tick", async (payload) => calls.push(`once:${payload}`));

  await bus.publish("tick", 1);
  await bus.publish("tick", 2);

  assert.deepEqual(calls, ["a:1", "once:1", "a:2"]);
  assert.equal(bus.listenerCount("tick"), 1);
});

test("EngineRegistry starts dependencies first and stops in reverse", async () => {
  const calls = [];
  const registry = new EngineRegistry();
  registry.register({
    id: "data",
    start: async () => calls.push("start:data"),
    stop: async () => calls.push("stop:data"),
  });
  registry.register({
    id: "strategy",
    dependencies: ["data"],
    start: async () => calls.push("start:strategy"),
    stop: async () => calls.push("stop:strategy"),
  });

  await registry.startAll();
  await registry.stopAll();

  assert.deepEqual(calls, [
    "start:data",
    "start:strategy",
    "stop:strategy",
    "stop:data",
  ]);
});

test("NusaRuntime loads plugins before engines and disposes safely", async () => {
  const calls = [];
  const runtime = new NusaRuntime();
  runtime.plugins.add({
    id: "example.plugin",
    version: "1.0.0",
    register: ({ engines }) => {
      calls.push("plugin:register");
      engines.register({
        id: "example.engine",
        start: async () => calls.push("engine:start"),
        stop: async () => calls.push("engine:stop"),
      });
    },
    dispose: async () => calls.push("plugin:dispose"),
  });

  await runtime.start();
  assert.equal(runtime.isStarted(), true);
  await runtime.stop();

  assert.equal(runtime.isStarted(), false);
  assert.deepEqual(calls, [
    "plugin:register",
    "engine:start",
    "engine:stop",
    "plugin:dispose",
  ]);
});

test("EngineRegistry rejects cyclic dependencies", async () => {
  const registry = new EngineRegistry();
  registry.register({ id: "a", dependencies: ["b"], start() {} });
  registry.register({ id: "b", dependencies: ["a"], start() {} });
  await assert.rejects(() => registry.startAll(), /Cyclic engine dependency/);
});
