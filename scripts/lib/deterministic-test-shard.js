function parsePositiveInteger(value, fallback, name) {
  const raw = value == null || String(value).trim() === "" ? fallback : Number(value);
  if (!Number.isInteger(raw) || raw < 1) throw new Error(`${name} must be a positive integer`);
  return raw;
}

function parseNonNegativeInteger(value, fallback, name) {
  const raw = value == null || String(value).trim() === "" ? fallback : Number(value);
  if (!Number.isInteger(raw) || raw < 0) throw new Error(`${name} must be a non-negative integer`);
  return raw;
}

function resolveShardConfig(env = process.env) {
  const count = parsePositiveInteger(env.NUSA_TEST_SHARD_COUNT, 1, "NUSA_TEST_SHARD_COUNT");
  const index = parseNonNegativeInteger(env.NUSA_TEST_SHARD_INDEX, 0, "NUSA_TEST_SHARD_INDEX");
  if (index >= count) throw new Error(`NUSA_TEST_SHARD_INDEX (${index}) must be less than NUSA_TEST_SHARD_COUNT (${count})`);
  return Object.freeze({ count, index });
}

function selectDeterministicShard(files, config) {
  const { count, index } = config;
  if (!Array.isArray(files)) throw new Error("files must be an array");
  if (!Number.isInteger(count) || count < 1) throw new Error("shard count must be a positive integer");
  if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error("shard index must be within shard count");
  return files.filter((_, position) => position % count === index);
}

module.exports = { resolveShardConfig, selectDeterministicShard };
