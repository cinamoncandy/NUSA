import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { CANONICAL_MODULE_REGISTRY_V10, validateCanonicalModuleRegistryV10 } from "./canonicalModuleRegistryV10";
import {
  MODULE_STAGE_ORDER,
  deterministicSha256,
  runLevel10Module,
  type Level10Module,
  type ModuleExecutionContext,
  type ModuleStage
} from "./moduleLevel10";
import { PipelineOrchestratorV10, type Level10ModuleBundle } from "./pipelineOrchestratorV10";

const context: ModuleExecutionContext = Object.freeze({
  traceId: "trace-v10",
  idempotencyKey: "run-v10",
  now: 1_000,
  mode: "PAPER"
});

function moduleFor(stage: ModuleStage, fail = false): Level10Module<unknown, unknown> {
  return Object.freeze({
    stage,
    version: "10",
    execute: (input: unknown) => {
      if (fail) throw new Error(`${stage}_FAILURE`);
      return Object.freeze({ stage, previous: input });
    }
  });
}

function bundle(failingStage?: ModuleStage): Level10ModuleBundle {
  return Object.fromEntries(MODULE_STAGE_ORDER.map((stage) => [stage, moduleFor(stage, stage === failingStage)])) as Level10ModuleBundle;
}

describe("level-10 module contract", () => {
  it("hashes equivalent objects deterministically regardless of key order", () => {
    assert.equal(deterministicSha256({ b: 2, a: 1 }), deterministicSha256({ a: 1, b: 2 }));
  });

  it("fails closed and records evidence instead of leaking a stage exception", async () => {
    const result = await runLevel10Module(moduleFor("RISK", true), { intent: "BUY" }, context);
    assert.equal(result.status, "FAILED_CLOSED");
    assert.equal(result.evidence.stage, "RISK");
    assert.equal(result.evidence.error, "RISK_FAILURE");
    assert.equal(result.output, undefined);
  });

  it("rejects any runtime mode outside PAPER/SHADOW", async () => {
    const invalid = { ...context, mode: "LIVE" } as unknown as ModuleExecutionContext;
    await assert.rejects(runLevel10Module(moduleFor("EXECUTION"), {}, invalid), /LIVE authority is forbidden/);
  });
});

describe("canonical v10 registry", () => {
  it("contains every stage exactly once and points at real source files", () => {
    validateCanonicalModuleRegistryV10();
    assert.deepEqual(CANONICAL_MODULE_REGISTRY_V10.map((definition) => definition.stage), [...MODULE_STAGE_ORDER]);
    for (const definition of CANONICAL_MODULE_REGISTRY_V10) {
      assert.equal(existsSync(resolve(process.cwd(), definition.canonicalEntrypoint)), true, definition.canonicalEntrypoint);
    }
  });
});

describe("PipelineOrchestratorV10", () => {
  it("runs all ten stages in canonical order with evidence", async () => {
    const result = await new PipelineOrchestratorV10(bundle()).run({ seed: true }, context);
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.evidence.length, MODULE_STAGE_ORDER.length);
    assert.deepEqual(result.evidence.map((item) => item.stage), [...MODULE_STAGE_ORDER]);
    assert.equal(result.evidence.every((item) => item.status === "COMPLETED"), true);
  });

  it("halts immediately at the first failed-closed module", async () => {
    const result = await new PipelineOrchestratorV10(bundle("PORTFOLIO")).run({ seed: true }, context);
    assert.equal(result.status, "FAILED_CLOSED");
    assert.equal(result.haltedAt, "PORTFOLIO");
    assert.deepEqual(result.evidence.map((item) => item.stage), [
      "MARKET_DATA", "INTELLIGENCE", "STRATEGY", "DECISION", "RISK", "PORTFOLIO"
    ]);
  });
});
