const test = require("node:test");
const assert = require("node:assert/strict");
const { selectJevCodingModel } = require("../dist/apps/autopilot/src/jevCodingModelTier.js");

const admitted = (overrides = {}) => ({
  action: "PROCEED_EXISTING",
  reasonCode: "JEV_ADMITTED",
  rootCause: "CODE",
  safeToAutofix: "YES",
  severity: 2,
  requiredModel: "LUNA",
  confidence: 0.97,
  provider: "jev",
  aiAuthority: "ZERO_AUTHORITY",
  productionMutationAllowed: false,
  liveAuthority: "NONE",
  ...overrides,
});

const enabled = {
  NUSA_JEV_MODEL_TIERING_ENABLED: "true",
  NUSA_AI_CODING_MODEL_LUNA: "@cf/openai/gpt-oss-20b",
  NUSA_AI_CODING_MODEL_TERRA: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  NUSA_AI_CODING_MODEL_SOL: "@cf/meta/llama-4-scout-17b-16e-instruct",
  NUSA_AI_CODING_MODEL_ASTRA: "@cf/qwen/qwen3-30b-a3b-fp8",
};

test("bounded Jev tiering selects only the explicitly configured matching tier", () => {
  for (const tier of ["LUNA", "TERRA", "SOL", "ASTRA"]) {
    const selected = selectJevCodingModel(admitted({ requiredModel: tier }), enabled);
    assert.ok(selected);
    assert.equal(selected.tier, tier);
    assert.equal(selected.model, enabled[`NUSA_AI_CODING_MODEL_${tier}`]);
    assert.equal(selected.confidence, 0.97);
    assert.equal(selected.aiAuthority, "ZERO_AUTHORITY");
    assert.equal(selected.productionMutationAllowed, false);
    assert.equal(selected.liveAuthority, "NONE");
  }
});

test("disabled and non-admitted decisions preserve canonical model selection", () => {
  assert.equal(selectJevCodingModel(admitted(), {}), null);
  assert.equal(selectJevCodingModel(admitted({ reasonCode: "LOW_CONFIDENCE" }), enabled), null);
  assert.equal(selectJevCodingModel(admitted({ provider: null }), enabled), null);
  assert.equal(selectJevCodingModel(admitted({ action: "ABSTAIN_EXPENSIVE_INFERENCE" }), enabled), null);
});

test("unsafe, low-confidence, human, non-code and unconfigured routes preserve canonical model selection", () => {
  assert.equal(selectJevCodingModel(admitted({ safeToAutofix: "NO" }), enabled), null);
  assert.equal(selectJevCodingModel(admitted({ confidence: 0.899 }), enabled), null);
  assert.equal(selectJevCodingModel(admitted({ requiredModel: "HUMAN" }), enabled), null);
  assert.equal(selectJevCodingModel(admitted({ rootCause: "INFRA" }), enabled), null);
  assert.equal(selectJevCodingModel(admitted({ rootCause: "AUTH" }), enabled), null);
  assert.equal(selectJevCodingModel(admitted({ rootCause: "RUNNER" }), enabled), null);
  assert.equal(selectJevCodingModel(admitted({ rootCause: "FLAKY" }), enabled), null);
  assert.equal(selectJevCodingModel(admitted(), { NUSA_JEV_MODEL_TIERING_ENABLED: "true" }), null);
});

test("TEST root cause may select a configured tier under the same accepted evidence gate", () => {
  const selected = selectJevCodingModel(admitted({ rootCause: "TEST", requiredModel: "TERRA" }), enabled);
  assert.ok(selected);
  assert.equal(selected.tier, "TERRA");
  assert.equal(selected.model, enabled.NUSA_AI_CODING_MODEL_TERRA);
});

test("repair-reuse and provider fallback decisions cannot lower the model", () => {
  assert.equal(selectJevCodingModel(admitted({
    reasonCode: "REPAIR_ATTEMPT_REUSES_INITIAL_ADMISSION",
    provider: null,
  }), enabled), null);
  assert.equal(selectJevCodingModel(admitted({
    reasonCode: "PROVIDER_UNAVAILABLE",
    provider: null,
  }), enabled), null);
});
