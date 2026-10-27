const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const coreDir = path.join(root, "packages/core/src/optimizer");
const files = ["aiStrategyEngine", "aiBacktestEngine", "aiStrategyOptimizer"];

test("optimizer core lives in packages/core and imports nothing from apps/ or react-native", () => {
  for (const name of files) {
    const source = fs.readFileSync(path.join(coreDir, `${name}.ts`), "utf8");
    const specifiers = [...source.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((m) => m[1]);
    for (const spec of specifiers) {
      assert.ok(spec.startsWith("./"), `${name}.ts imports ${spec}; optimizer core may import only its own siblings`);
    }
  }
});

test("mobile files are thin re-export shims so existing imports keep working", () => {
  for (const name of files) {
    const shim = fs.readFileSync(path.join(root, `apps/mobile/src/${name}.ts`), "utf8").trim();
    assert.equal(shim, `export * from "../../../packages/core/src/optimizer/${name}";`);
  }
});

test("the optimizer is reachable through the core path with unchanged behavior", () => {
  const core = require("../dist/packages/core/src/optimizer/aiStrategyOptimizer.js");
  const mobile = require("../dist/apps/mobile/src/aiStrategyOptimizer.js");
  assert.equal(core.generateStrategyCandidates, mobile.generateStrategyCandidates);
  assert.equal(core.runStrategyOptimization, mobile.runStrategyOptimization);
  assert.equal(typeof core.InMemoryStrategyOptimizerRunRepository, "function");
});
