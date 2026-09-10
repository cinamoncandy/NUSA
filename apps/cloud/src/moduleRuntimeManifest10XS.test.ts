import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { MODULE_STAGE_ORDER } from "./moduleLevel10";
import { MODULE_RUNTIME_MANIFEST_10XS } from "./moduleRuntimeManifest10XS";

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

describe("10X-S runtime truth manifest", () => {
  it("binds every canonical stage to a real runtime path with independently addressable LKG state", () => {
    assert.deepEqual(MODULE_RUNTIME_MANIFEST_10XS.map((binding) => binding.stage), [...MODULE_STAGE_ORDER]);
    assert.equal(new Set(MODULE_RUNTIME_MANIFEST_10XS.map((binding) => binding.stage)).size, MODULE_STAGE_ORDER.length);
    for (const binding of MODULE_RUNTIME_MANIFEST_10XS) {
      assert.equal(existsSync(resolve(process.cwd(), binding.canonicalEntrypoint)), true, binding.canonicalEntrypoint);
      assert.equal(existsSync(resolve(process.cwd(), binding.runtimeEntrypoint)), true, binding.runtimeEntrypoint);
      assert.match(binding.lastKnownGoodRef, /^[0-9a-f]{40}$/);
      for (const ref of binding.evidenceRefs) assert.equal(existsSync(resolve(process.cwd(), ref)), true, `${binding.stage}:${ref}`);
    }
    for (let index = 1; index < MODULE_RUNTIME_MANIFEST_10XS.length; index += 1) {
      assert.notEqual(MODULE_RUNTIME_MANIFEST_10XS[index]?.evidenceRefs, MODULE_RUNTIME_MANIFEST_10XS[index - 1]?.evidenceRefs, "each stage must own its evidence collection");
    }
  });

  it("routes cloud intelligence and portfolio composition through their canonical facades", () => {
    const hydrator = read("apps/cloud/src/cloudRuntimeDashboardHydrator.ts");
    assert.match(hydrator, /runIntelligenceEngineV10/);
    assert.match(hydrator, /runPortfolioEngineV10/);
    assert.doesNotMatch(hydrator, /\bfuseMarketIntelligence\s*\(/);
    assert.doesNotMatch(hydrator, /\bbuildPortfolioPlan\s*\(/);
  });

  it("keeps the PAPER mutation path behind canonical risk and execution boundaries", () => {
    const runtime = read("apps/cloud/src/runtime.ts");
    const execution = read("apps/cloud/src/cloudPaperExecutionBoundary.ts");
    assert.match(runtime, /new CloudPaperCanonicalRiskGateway/);
    assert.match(runtime, /new CloudPaperExecutionBoundary/);
    assert.match(runtime, /productionPaperBoundary\?\.processTick\(tick\)/);
    assert.match(execution, /riskGate\.evaluate\(/);
    assert.match(execution, /if \(risk\.status !== "ALLOW"\)/);
  });

  it("binds review and durable learning memory to the live PAPER composition root", () => {
    const runtime = read("apps/cloud/src/runtime.ts");
    assert.match(runtime, /new PaperLearningEventRecorder/);
    assert.match(runtime, /new SqliteEvolutionLearningLedger/);
  });
});
