const test = require("node:test");
const assert = require("node:assert/strict");

const { RuntimeCompositionRoot } = require("../dist/packages/core/src/runtimeCompositionRoot.js");

test("RuntimeCompositionRoot creates once and starts and stops engines once", async () => {
  let starts = 0;
  let stops = 0;
  const root = new RuntimeCompositionRoot([{
    id: "test.runtime",
    start: () => { starts += 1; },
    stop: () => { stops += 1; }
  }]);

  assert.equal(root.isStarted(), false);
  assert.equal(starts, 0);
  assert.equal(stops, 0);
  assert.deepEqual(root.engineStates(), [{ id: "test.runtime", state: "registered" }]);

  await Promise.all([root.start(), root.start(), root.start()]);
  await root.start();
  assert.equal(root.isStarted(), true);
  assert.equal(starts, 1);

  await Promise.all([root.stop(), root.stop(), root.stop()]);
  assert.equal(root.isStarted(), false);
  assert.equal(stops, 1);
  await root.stop();
  assert.equal(stops, 1);
});
