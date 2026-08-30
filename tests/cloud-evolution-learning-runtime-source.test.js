const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const runtime = fs.readFileSync(path.join(root, "apps/cloud/src/runtime.ts"), "utf8");
const storage = fs.readFileSync(path.join(root, "packages/storage/src/index.ts"), "utf8");

test("cloud runtime projects evolution learning from the canonical durable sqlite database", () => {
  assert.match(runtime, /SqliteEvolutionLearningLedger/);
  assert.match(runtime, /buildEvolutionLearningSupervisorSnapshot/);
  assert.match(runtime, /durableAuthDatabase == null[\s\S]*loadEvolutionLearning/);
  assert.match(runtime, /new SqliteEvolutionLearningLedger\(durableAuthDatabase\)\.replay\(\)/);
  assert.match(runtime, /loadEvolutionLearning/);
  assert.match(storage, /020_evolution_learning_ledger/);
});

test("runtime source remains read-only and fail-closed when durable sqlite is unavailable", () => {
  assert.match(runtime, /const loadEvolutionLearning = durableAuthDatabase == null\s*\? undefined/);
  assert.doesNotMatch(runtime, /\.append\(/);
  assert.doesNotMatch(runtime, /productionMutationAllowed:\s*true/);
  assert.doesNotMatch(runtime, /liveAuthority:\s*["'](?!NONE)/);
});
