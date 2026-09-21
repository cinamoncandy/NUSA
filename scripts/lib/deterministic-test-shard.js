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

function selectDeterministicShard(files, config, pinnedFiles = {}) {
  const { count, index } = config;
  if (!Array.isArray(files)) throw new Error("files must be an array");
  if (!Number.isInteger(count) || count < 1) throw new Error("shard count must be a positive integer");
  if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error("shard index must be within shard count");
  if (!pinnedFiles || typeof pinnedFiles !== "object" || Array.isArray(pinnedFiles)) throw new Error("pinned files must be an object");

  const pins = new Map();
  for (const [file, pinnedIndex] of Object.entries(pinnedFiles)) {
    const normalized = String(file).replace(/\\/g, "/");
    if (!normalized.trim()) throw new Error("pinned test path must be non-empty");
    if (!Number.isInteger(pinnedIndex) || pinnedIndex < 0 || pinnedIndex >= count) throw new Error("pinned shard index must be within shard count");
    if (pins.has(normalized)) throw new Error("pinned test path must be unique");
    pins.set(normalized, pinnedIndex);
  }

  return files.filter((file, position) => {
    const normalized = String(file).replace(/\\/g, "/");
    const pinnedIndex = pins.get(normalized);
    return pinnedIndex === undefined ? position % count === index : pinnedIndex === index;
  });
}

module.exports = { resolveShardConfig, selectDeterministicShard };
