const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveShardConfig, selectDeterministicShard } = require("../scripts/lib/deterministic-test-shard.js");

test("deterministic shards are disjoint and cover every input exactly once", () => {
  const files = Array.from({ length: 37 }, (_, index) => `tests/file-${String(index).padStart(2, "0")}.test.js`);
  const shards = Array.from({ length: 4 }, (_, index) => selectDeterministicShard(files, { index, count: 4 }));
  const flattened = shards.flat();
  assert.equal(flattened.length, files.length);
  assert.equal(new Set(flattened).size, files.length);
  assert.deepEqual([...flattened].sort(), [...files].sort());
  assert.deepEqual(shards[0], files.filter((_, index) => index % 4 === 0));
});

test("pinned slow tests move deterministically without duplication across path separators", () => {
  const slow = "tests\\oracle-readiness-check.test.js";
  const files = [
    "tests/a.test.js",
    "tests/b.test.js",
    "tests/c.test.js",
    slow,
    "tests/d.test.js",
    "tests/e.test.js",
    "tests/f.test.js",
    "tests/g.test.js",
  ];
  const pins = { "tests/oracle-readiness-check.test.js": 0 };
  const shards = Array.from({ length: 4 }, (_, index) => selectDeterministicShard(files, { index, count: 4 }, pins));
  const flattened = shards.flat();

  assert.equal(flattened.length, files.length);
  assert.equal(new Set(flattened).size, files.length);
  assert.deepEqual([...flattened].sort(), [...files].sort());
  assert.equal(shards[0].includes(slow), true);
  assert.equal(shards[3].includes(slow), false);
  assert.throws(
    () => selectDeterministicShard(files, { index: 0, count: 4 }, { "tests/oracle-readiness-check.test.js": 4 }),
    /pinned shard index must be within shard count/,
  );
});

test("shard environment defaults to the full suite", () => {
  assert.deepEqual(resolveShardConfig({}), { index: 0, count: 1 });
});

test("shard environment fails closed on malformed or out-of-range values", () => {
  assert.throws(() => resolveShardConfig({ NUSA_TEST_SHARD_COUNT: "0" }), /positive integer/);
  assert.throws(() => resolveShardConfig({ NUSA_TEST_SHARD_COUNT: "4", NUSA_TEST_SHARD_INDEX: "4" }), /must be less than/);
  assert.throws(() => resolveShardConfig({ NUSA_TEST_SHARD_COUNT: "4", NUSA_TEST_SHARD_INDEX: "1.5" }), /non-negative integer/);
});
