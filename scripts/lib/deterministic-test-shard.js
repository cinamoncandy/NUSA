function parsePositiveInteger(value, fallback, name) {
  const raw = value == null || String(value).trim() === "" ? fallback : Number(value);
  if (!Number.isInteger(raw) || raw < 1) throw new Error(name + " must be a positive integer");
  return raw;
}

function parseNonNegativeInteger(value, fallback, name) {
  const raw = value == null || String(value).trim() === "" ? fallback : Number(value);
  if (!Number.isInteger(raw) || raw < 0) throw new Error(name + " must be a non-negative integer");
  return raw;
}

function resolveShardConfig(env = process.env) {
  const count = parsePositiveInteger(env.NUSA_TEST_SHARD_COUNT, 1, "NUSA_TEST_SHARD_COUNT");
  const index = parseNonNegativeInteger(env.NUSA_TEST_SHARD_INDEX, 0, "NUSA_TEST_SHARD_INDEX");
  if (index >= count) throw new Error("NUSA_TEST_SHARD_INDEX (" + index + ") must be less than NUSA_TEST_SHARD_COUNT (" + count + ")");
  return Object.freeze({ count, index });
}

function normalizeTestPath(file) {
  if (typeof file !== "string" || file.trim() === "") throw new Error("test paths must be non-empty strings");
  return file.replace(/\\/g, "/");
}

function validateCostEvidence(evidence) {
  if (!evidence || evidence.schemaVersion !== 1 || !Array.isArray(evidence.sourceRuns) || evidence.sourceRuns.length < 2) {
    throw new Error("test shard cost evidence is missing or invalid");
  }
  const runIds = new Set();
  const sourceShas = new Set();
  for (const run of evidence.sourceRuns) {
    if (!run || !/^\d+$/.test(String(run.runId ?? "")) || !/^[a-f0-9]{40}$/i.test(String(run.sourceSha ?? ""))) {
      throw new Error("test shard source run identity is invalid");
    }
    runIds.add(String(run.runId));
    sourceShas.add(String(run.sourceSha).toLowerCase());
  }
  if (runIds.size !== evidence.sourceRuns.length || sourceShas.size !== evidence.sourceRuns.length) {
    throw new Error("test shard source runs must be distinct");
  }
  if (!Number.isSafeInteger(evidence.defaultDurationMs) || evidence.defaultDurationMs < 1) {
    throw new Error("test shard default duration evidence must be a positive integer");
  }
  if (!evidence.costsMs || typeof evidence.costsMs !== "object" || Array.isArray(evidence.costsMs)) {
    throw new Error("test shard per-file cost evidence is missing");
  }
  const entries = Object.entries(evidence.costsMs);
  if (entries.length === 0) throw new Error("test shard per-file cost evidence is empty");
  const normalizedCostPaths = new Set();
  for (const [file, cost] of entries) {
    const normalizedPath = normalizeTestPath(file);
    if (normalizedCostPaths.has(normalizedPath)) throw new Error("duplicate test shard cost path: " + normalizedPath);
    normalizedCostPaths.add(normalizedPath);
    if (!Number.isSafeInteger(cost) || cost < 1) throw new Error("test shard cost for " + file + " must be a positive integer");
  }
  return evidence;
}

function selectCostAwareShards(files, count, costEvidence) {
  if (!Array.isArray(files)) throw new Error("files must be an array");
  if (!Number.isInteger(count) || count < 1) throw new Error("shard count must be a positive integer");
  const evidence = validateCostEvidence(costEvidence);
  const normalizedFiles = files.map((file) => ({ file, path: normalizeTestPath(file) }));
  const seen = new Set();
  for (const item of normalizedFiles) {
    if (seen.has(item.path)) throw new Error("duplicate test path: " + item.path);
    seen.add(item.path);
  }

  const costs = new Map(Object.entries(evidence.costsMs).map(([file, cost]) => [normalizeTestPath(file), cost]));
  const units = normalizedFiles.map((item) => ({
    ...item,
    cost: costs.get(item.path) ?? evidence.defaultDurationMs
  }));
  units.sort((a, b) => b.cost - a.cost || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const loads = Array.from({ length: count }, () => 0);
  const assignments = new Map();
  for (const unit of units) {
    let target = 0;
    for (let index = 1; index < count; index += 1) {
      if (loads[index] < loads[target]) target = index;
    }
    assignments.set(unit.path, target);
    loads[target] += unit.cost;
  }

  return Object.freeze({
    shards: Array.from({ length: count }, (_, index) =>
      normalizedFiles.filter((item) => assignments.get(item.path) === index).map((item) => item.file)
    ),
    estimatedLoadsMs: Object.freeze(loads)
  });
}

function selectDeterministicShard(files, config, costEvidence) {
  const { count, index } = config;
  if (!Number.isInteger(count) || count < 1) throw new Error("shard count must be a positive integer");
  if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error("shard index must be within shard count");
  return selectCostAwareShards(files, count, costEvidence).shards[index];
}

module.exports = { resolveShardConfig, selectDeterministicShard, selectCostAwareShards, validateCostEvidence };
