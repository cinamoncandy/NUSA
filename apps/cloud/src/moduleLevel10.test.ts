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
    tier: "10X-S",
    execute: (input: unknown) => {
      if (fail) throw new Error(`${stage}_FAILURE`);
      return Object.freeze({ stage, previous: input });
    }
  });
}

function bundle(failingStage?: ModuleStage): Level10ModuleBundle<unknown, unknown, unknown, unknown> {
  return Object.fromEntries(MODULE_STAGE_ORDER.map((stage) => [stage, moduleFor(stage, stage === failingStage)])) as Level10ModuleBundle<unknown, unknown, unknown, unknown>;
}

describe("level-10/10X-S module contract", () => {
  it("hashes equivalent objects deterministically regardless of key order", () => {
    assert.equal(deterministicSha256({ b: 2, a: 1 }), deterministicSha256({ a: 1, b: 2 }));
  });

  it("fails closed and records evidence instead of leaking a stage exception", async () => {
    const result = await runLevel10Module(moduleFor("RISK", true), { intent: "BUY" }, context);
    assert.equal(result.status, "FAILED_CLOSED");
    assert.equal(result.evidence.stage, "RISK");
    assert.equal(result.evidence.moduleTier, "10X-S");
    assert.equal(result.evidence.error, "RISK_FAILURE");
    assert.equal(result.output, undefined);
  });

  it("fails closed for any runtime mode outside PAPER/SHADOW", async () => {
    const invalid = { ...context, mode: "LIVE" } as unknown as ModuleExecutionContext;
    const result = await runLevel10Module(moduleFor("EXECUTION"), {}, invalid);
    assert.equal(result.status, "FAILED_CLOSED");
    assert.match(result.evidence.error ?? "", /LIVE authority is forbidden/);
  });

  it("fails closed when evidence input cannot be deterministically serialized", async () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const result = await runLevel10Module(moduleFor("MARKET_DATA"), cyclic, context);
    assert.equal(result.status, "FAILED_CLOSED");
    assert.match(result.evidence.error ?? "", /cyclic/);
  });
});

describe("canonical v10 compatibility registry", () => {
  it("contains every stage exactly once and points at real source files", () => {
    validateCanonicalModuleRegistryV10();
    assert.deepEqual(CANONICAL_MODULE_REGISTRY_V10.map((definition) => definition.stage), [...MODULE_STAGE_ORDER]);
    for (const definition of CANONICAL_MODULE_REGISTRY_V10) {
      assert.equal(existsSync(resolve(process.cwd(), definition.canonicalEntrypoint)), true, definition.canonicalEntrypoint);
    }
  });
});

describe("PipelineOrchestratorV10", () => {
  it("runs all ten stages in canonical order with 10X-S evidence", async () => {
    const result = await new PipelineOrchestratorV10(bundle()).run({ seed: true }, context);
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.evidence.length, MODULE_STAGE_ORDER.length);
    assert.deepEqual(result.evidence.map((item) => item.stage), [...MODULE_STAGE_ORDER]);
    assert.equal(result.evidence.every((item) => item.status === "COMPLETED"), true);
    assert.equal(result.evidence.every((item) => item.moduleTier === "10X-S"), true);
  });

  it("halts immediately at the first failed-closed module", async () => {
    const result = await new PipelineOrchestratorV10(bundle("PORTFOLIO")).run({ seed: true }, context);
    assert.equal(result.status, "FAILED_CLOSED");
    assert.equal(result.haltedAt, "PORTFOLIO");
    assert.deepEqual(result.evidence.map((item) => item.stage), [
      "MARKET_DATA", "INTELLIGENCE", "STRATEGY", "DECISION", "PORTFOLIO"
    ]);
  });

  it("passes bounded portfolio quantity to risk before execution", async () => {
    type Decision = Readonly<{ requestedQuantity: number; price: number }>;
    type Sized = Readonly<{ quantity: number; price: number; notional: number }>;
    type Risked = Readonly<{ quantity: number; price: number; notional: number; risk: "ALLOW" }>;
    type Executed = Readonly<{ submittedQuantity: number }>;

    const observedRiskQuantities: number[] = [];
    const modules = bundle() as Level10ModuleBundle<Decision, Sized, Risked, Executed>;
    const typedModules: Level10ModuleBundle<Decision, Sized, Risked, Executed> = Object.freeze({
      ...modules,
      DECISION: Object.freeze({
        stage: "DECISION" as const,
        version: "10" as const,
        tier: "10X-S" as const,
        execute: () => Object.freeze({ requestedQuantity: 10, price: 100 })
      }),
      PORTFOLIO: Object.freeze({
        stage: "PORTFOLIO" as const,
        version: "10" as const,
        tier: "10X-S" as const,
        execute: (decision: Decision) => {
          const quantity = Math.min(decision.requestedQuantity, 2);
          return Object.freeze({ quantity, price: decision.price, notional: quantity * decision.price });
        }
      }),
      RISK: Object.freeze({
        stage: "RISK" as const,
        version: "10" as const,
        tier: "10X-S" as const,
        execute: (sized: Sized) => {
          observedRiskQuantities.push(sized.quantity);
          if (sized.notional > 200) throw new Error("NOTIONAL_LIMIT_EXCEEDED");
          return Object.freeze({ ...sized, risk: "ALLOW" as const });
        }
      }),
      EXECUTION: Object.freeze({
        stage: "EXECUTION" as const,
        version: "10" as const,
        tier: "10X-S" as const,
        execute: (risked: Risked) => Object.freeze({ submittedQuantity: risked.quantity })
      })
    });

    const result = await new PipelineOrchestratorV10(typedModules).run({ seed: true }, context);
    assert.equal(result.status, "COMPLETED");
    assert.deepEqual(observedRiskQuantities, [2]);
    assert.deepEqual(result.evidence.slice(3, 7).map((item) => item.stage), ["DECISION", "PORTFOLIO", "RISK", "EXECUTION"]);
  });
});
