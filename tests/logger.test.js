const test = require("node:test");
const assert = require("node:assert/strict");
const { Logger } = require("../dist/apps/server/src/logger.js");

function entry(overrides = {}) {
  return {
    timestamp: "2026-01-01T00:00:00.000Z",
    requestId: "r1",
    userId: "operator",
    method: "GET",
    pathname: "/api/health",
    status: 200,
    durationMs: 1.5,
    ...overrides
  };
}

test("constructor validates maxEntries", () => {
  assert.throws(() => new Logger(() => {}, 0), /maxEntries must be a positive integer/);
  assert.throws(() => new Logger(() => {}, 1.5), /maxEntries must be a positive integer/);
});

test("log() invokes the sink with the exact entry and stores it", () => {
  const sunk = [];
  const logger = new Logger((e) => sunk.push(e));
  logger.log(entry());
  assert.equal(sunk.length, 1);
  assert.deepEqual(sunk[0], entry());
  assert.deepEqual(logger.recent(), [entry()]);
});

test("recent() returns newest-first, matching ControlPlane's own event-log convention", () => {
  const logger = new Logger(() => {});
  logger.log(entry({ requestId: "first" }));
  logger.log(entry({ requestId: "second" }));
  logger.log(entry({ requestId: "third" }));
  assert.deepEqual(logger.recent().map((e) => e.requestId), ["third", "second", "first"]);
});

test("bounded: oldest entries drop once maxEntries is exceeded", () => {
  const logger = new Logger(() => {}, 3);
  for (let i = 0; i < 5; i++) logger.log(entry({ requestId: `r${i}` }));
  assert.deepEqual(logger.recent().map((e) => e.requestId), ["r4", "r3", "r2"]);
});

test("commandId/deviceId are optional -- absent on a plain GET with no device header", () => {
  const logger = new Logger(() => {});
  logger.log(entry());
  assert.equal(logger.recent()[0].commandId, undefined);
  assert.equal(logger.recent()[0].deviceId, undefined);
});

test("commandId/deviceId are carried through when present", () => {
  const logger = new Logger(() => {});
  logger.log(entry({ commandId: "c1", deviceId: "d1", method: "POST" }));
  assert.equal(logger.recent()[0].commandId, "c1");
  assert.equal(logger.recent()[0].deviceId, "d1");
});
