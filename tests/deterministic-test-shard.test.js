const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveShardConfig,
  selectDeterministicShard,
  selectCostAwareShards
} = require("../scripts/lib/deterministic-test-shard.js");

const evidence = {
  schemaVersion: 1,
  sourceRuns: [
    { runId: "1001", sourceSha: "a".repeat(40) },
    { runId: "1002", sourceSha: "b".repeat(40) }
  ],
  defaultDurationMs: 10,
  costsMs: {
    "tests/slow-a.test.js": 40,
    "tests/slow-b.test.js": 30,
    "tests/slow-c.test.js": 20
  }
};

test("cost-aware shards are deterministic, disjoint, and cover every input exactly once", () => {
  const files = Array.from({ length: 37 }, (_, index) =>
    "tests/file-" + String(index).padStart(2, "0") + ".test.js"
  );
  const first = selectCostAwareShards(files, 4, evidence);
  const replay = selectCostAwareShards([...files].reverse(), 4, evidence);
  const flattened = first.shards.flat();
  assert.equal(first.shards.length, 4);
  assert.equal(flattened.length, files.length);
  assert.equal(new Set(flattened).size, files.length);
  assert.deepEqual([...flattened].sort(), [...files].sort());
  assert.deepEqual(first.shards.map((shard) => [...shard].sort()), replay.shards.map((shard) => [...shard].sort()));
});

test("measured expensive files are assigned to reduce estimated shard imbalance", () => {
  const files = ["tests/slow-a.test.js", "tests/slow-b.test.js", "tests/slow-c.test.js", "tests/fast.test.js"];
  const result = selectCostAwareShards(files, 2, evidence);
  assert.deepEqual(result.estimatedLoadsMs, [50, 50]);
  assert.notEqual(result.shards[0].includes("tests/slow-a.test.js"), result.shards[1].includes("tests/slow-a.test.js"));
});

test("path separators normalize and unseen tests use the evidence-backed median", () => {
  const files = ["tests\\slow-a.test.js", "tests/new.test.js"];
  const shards = selectCostAwareShards(files, 2, evidence);
  assert.deepEqual(shards.estimatedLoadsMs, [40, 10]);
  assert.equal(selectDeterministicShard(files, { index: 0, count: 2 }, evidence).length, 1);
});

test("empty or malformed cost evidence fails closed", () => {
  assert.throws(() => selectCostAwareShards(["a.test.js"], 4, null), /missing or invalid/);
  assert.throws(() => selectCostAwareShards(["a.test.js"], 4, { ...evidence, costsMs: {} }), /empty/);
  assert.throws(() => selectCostAwareShards(["a.test.js"], 4, { ...evidence, defaultDurationMs: 0 }), /positive integer/);
  assert.throws(() => selectCostAwareShards(["a.test.js"], 4, { ...evidence, sourceRuns: [{ runId: "missing-sha" }, { runId: "1002", sourceSha: "b".repeat(40) }] }), /source run identity/);
  assert.throws(() => selectCostAwareShards(["a.test.js"], 4, { ...evidence, costsMs: { "a.test.js": -1 } }), /positive integer/);
  assert.throws(() => selectCostAwareShards(["a/test.js", "a\\test.js"], 4, evidence), /duplicate test path/);
});

test("equal-cost ties and shard selection use stable order", () => {
  const tied = { ...evidence, costsMs: { "b.test.js": 10, "a.test.js": 10, "c.test.js": 10, "d.test.js": 10 } };
  const first = selectCostAwareShards(["d.test.js", "c.test.js", "b.test.js", "a.test.js"], 2, tied);
  const second = selectCostAwareShards(["a.test.js", "b.test.js", "c.test.js", "d.test.js"], 2, tied);
  assert.deepEqual(first.shards.map((shard) => [...shard].sort()), second.shards.map((shard) => [...shard].sort()));
  assert.deepEqual(resolveShardConfig({ NUSA_TEST_SHARD_COUNT: "4", NUSA_TEST_SHARD_INDEX: "3" }), { count: 4, index: 3 });
});

test("shard environment defaults to the full suite and rejects malformed values", () => {
  assert.deepEqual(resolveShardConfig({}), { index: 0, count: 1 });
  assert.throws(() => resolveShardConfig({ NUSA_TEST_SHARD_COUNT: "0" }), /positive integer/);
  assert.throws(() => resolveShardConfig({ NUSA_TEST_SHARD_COUNT: "4", NUSA_TEST_SHARD_INDEX: "4" }), /must be less than/);
  assert.throws(() => resolveShardConfig({ NUSA_TEST_SHARD_COUNT: "4", NUSA_TEST_SHARD_INDEX: "1.5" }), /non-negative integer/);
});
