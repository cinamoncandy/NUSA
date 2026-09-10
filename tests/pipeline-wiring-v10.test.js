"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { basename, join } = require("node:path");

const {
  PIPELINE_WIRING_V10,
  V10_DECLARATION_FILES,
  isPipelineFullyWiredV10,
  stagesNotOnRuntimePath,
  stagesWithoutInputProducer
} = require("../dist/apps/cloud/src/pipelineWiringV10.js");

const ROOT = join(__dirname, "..");

/**
 * `docs/PIPELINE_TO_CODE.md` maps ten stages onto canonical entrypoints. These check the map
 * against the tree, because a registry entry and an architecture row are exactly what a module
 * nothing calls looks like from the outside.
 */

/** Non-test files referencing a symbol, excluding the module itself and the V10 declaration layer. */
function runtimeCallers(symbol, ownPathPrefix) {
  let output = "";
  try {
    output = execFileSync(
      "grep",
      ["-rln", "--include=*.ts", "--include=*.tsx", `\\b${symbol}\\b`, "apps", "packages", "scripts"],
      { cwd: ROOT, encoding: "utf8" }
    );
  } catch {
    return [];
  }
  return output.split("\n").filter((path) => {
    if (!path.trim()) return false;
    if (path.startsWith(ownPathPrefix)) return false;
    if (path.includes(".test.")) return false;
    // The wiring declaration names each entrypoint as a string. Naming is not calling.
    if (path.endsWith("pipelineWiringV10.ts")) return false;
    return !V10_DECLARATION_FILES.includes(path);
  });
}

test("every declared canonical entrypoint exists at the declared path", () => {
  for (const entry of PIPELINE_WIRING_V10) {
    assert.ok(
      existsSync(join(ROOT, `${entry.canonicalEntrypoint}.ts`)),
      `${entry.stage}: no file at ${entry.canonicalEntrypoint}.ts`
    );
  }
});

test("reach matches the import graph in both directions", () => {
  for (const entry of PIPELINE_WIRING_V10) {
    const callers = runtimeCallers(basename(entry.canonicalEntrypoint), entry.canonicalEntrypoint);
    if (entry.reach === "ON_RUNTIME_PATH") {
      assert.ok(
        callers.length > 0,
        `${entry.stage} claims ON_RUNTIME_PATH but nothing outside the V10 layer calls it`
      );
    } else {
      assert.deepEqual(
        callers,
        [],
        `${entry.stage} claims REGISTRY_ONLY but is now called by ${callers.join(", ")} -- ` +
          `update the declaration, this is progress worth recording`
      );
    }
  }
});

test("a REGISTRY_ONLY stage states what blocks it, and a wired stage states nothing", () => {
  for (const entry of PIPELINE_WIRING_V10) {
    if (entry.reach === "ON_RUNTIME_PATH") {
      assert.equal(entry.blocker, "", `${entry.stage} is wired; a blocker text would be stale`);
    } else {
      assert.ok(entry.blocker.length > 20, `${entry.stage} is unwired with no stated reason`);
    }
  }
});

test("the intelligence stage has no producer for the features its gate reads", () => {
  const intelligence = PIPELINE_WIRING_V10.find((entry) => entry.stage === "Intelligence");
  assert.equal(intelligence.requiredInputType, "MarketRegimeFeatures");
  const producers = runtimeCallers("MarketRegimeFeatures", "apps/cloud/src/marketRegimeEngine").filter(
    (path) =>
      // The contract that declares the type is not a producer of values of it.
      !path.endsWith("packages/contracts/src/marketRegime.ts") &&
      path !== "apps/cloud/src/intelligenceEngineV10.ts"
  );
  assert.deepEqual(
    producers,
    [],
    `MarketRegimeFeatures now has producers (${producers.join(", ")}); the intelligence stage ` +
      `may be feedable -- re-check whether they read live data before flipping inputs`
  );
});

test("the orchestrator itself is not yet driven by anything", () => {
  const callers = runtimeCallers("pipelineOrchestratorV10", "apps/cloud/src/pipelineOrchestratorV10");
  assert.deepEqual(
    callers,
    [],
    `pipelineOrchestratorV10 is now driven by ${callers.join(", ")} -- every REGISTRY_ONLY stage ` +
      `above became live at that moment and each declaration needs re-checking`
  );
});

test("the layer does not claim to be wired while stages are unreached or unfed", () => {
  assert.equal(isPipelineFullyWiredV10(), false);
  assert.ok(stagesNotOnRuntimePath().length > 0);
  assert.deepEqual(
    stagesWithoutInputProducer().map((entry) => entry.stage),
    ["Intelligence"]
  );
});

test("no stage declaration grants authority beyond PAPER", () => {
  const declaration = execFileSync("cat", ["apps/cloud/src/pipelineWiringV10.ts"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(/\bLIVE_AUTHORITY|liveAuthority\s*[:=]\s*["']?(?!NONE)/.test(declaration), false);
});
