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

test("bounded Jev tiering selects only an explicitly configured admitted model", () => {
  const selected = selectJevCodingModel(admitted(), {
    NUSA_JEV_MODEL_TIERING_ENABLED: "true",
    NUSA_AI_CODING_MODEL_LUNA: "@cf/openai/gpt-oss-20b",
  });
  assert.equal(selected.tier, "LUNA");
  assert.equal(selected.model, "@cf/openai/gpt-oss-20b");
  assert.equal(selected.aiAuthority, "ZERO_AUTHORITY");
});

test("disabled, unsafe, low-confidence, human and unconfigured routes preserve canonical model path", () => {
  assert.equal(selectJevCodingModel(admitted(), {}), null);
  assert.equal(selectJevCodingModel(admitted({ safeToAutofix: "NO" }), { NUSA_JEV_MODEL_TIERING_ENABLED: "true", NUSA_AI_CODING_MODEL_LUNA: "@cf/openai/gpt-oss-20b" }), null);
  assert.equal(selectJevCodingModel(admitted({ confidence: 0.7 }), { NUSA_JEV_MODEL_TIERING_ENABLED: "true", NUSA_AI_CODING_MODEL_LUNA: "@cf/openai/gpt-oss-20b" }), null);
  assert.equal(selectJevCodingModel(admitted({ requiredModel: "HUMAN" }), { NUSA_JEV_MODEL_TIERING_ENABLED: "true", NUSA_AI_CODING_MODEL_LUNA: "@cf/openai/gpt-oss-20b" }), null);
  assert.equal(selectJevCodingModel(admitted(), { NUSA_JEV_MODEL_TIERING_ENABLED: "true" }), null);
  assert.equal(selectJevCodingModel(admitted({ rootCause: "INFRA" }), { NUSA_JEV_MODEL_TIERING_ENABLED: "true", NUSA_AI_CODING_MODEL_LUNA: "@cf/openai/gpt-oss-20b" }), null);
});
