const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const runtime = fs.readFileSync(path.join(root, "apps/cloud/src/runtime.ts"), "utf8");
const storage = fs.readFileSync(path.join(root, "packages/storage/src/index.ts"), "utf8");

function evolutionLearningLoaderSource() {
  const start = runtime.indexOf("const loadEvolutionLearning =");
  assert.notEqual(start, -1, "evolution learning runtime source must exist");
  const end = runtime.indexOf(";", start);
  assert.notEqual(end, -1, "evolution learning runtime source must be a bounded declaration");
  return runtime.slice(start, end + 1);
}

test("cloud runtime projects evolution learning from the canonical durable sqlite database", () => {
  const source = evolutionLearningLoaderSource();
  assert.match(runtime, /SqliteEvolutionLearningLedger/);
  assert.match(runtime, /buildEvolutionLearningSupervisorSnapshot/);
  assert.match(source, /const loadEvolutionLearning = durableAuthDatabase == null/);
  assert.match(source, /new SqliteEvolutionLearningLedger\(durableAuthDatabase\)\.replay\(\)/);
  assert.match(runtime, /\.\.\.\(loadEvolutionLearning == null \? \{\} : \{ loadEvolutionLearning \}\)/);
  assert.match(storage, /020_evolution_learning_ledger/);
});

test("runtime source remains read-only and fail-closed when durable sqlite is unavailable", () => {
  const source = evolutionLearningLoaderSource();
  assert.match(source, /durableAuthDatabase == null\s*\? undefined/);
  assert.doesNotMatch(source, /\.append\(/);
  assert.doesNotMatch(source, /productionMutationAllowed:\s*true/);
  assert.doesNotMatch(source, /liveAuthority:\s*["'](?!NONE)/);
});
