const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createModelProviderFromEnvironment,
  createNVersionProviderPoolFromEnvironment,
  describeModelProvider
} = require("../dist/apps/cloud/src/ai/modelProvider.js");

const fullEnv = (overrides = {}) => ({
  NUSA_AI_ENABLED: "true",
  NUSA_AI_NVERSION_ENABLED: "true",
  NUSA_AI_OPENAI_API_KEY: "openai-secret-never-project",
  NUSA_AI_OPENAI_MODEL: "gpt-independent-test",
  NUSA_AI_OPENAI_FAMILY_ID: "openai-gpt-family",
  NUSA_AI_ANTHROPIC_API_KEY: "anthropic-secret-never-project",
  NUSA_AI_ANTHROPIC_MODEL: "claude-independent-test",
  NUSA_AI_ANTHROPIC_FAMILY_ID: "anthropic-claude-family",
  ...overrides
});

test("legacy primary OpenAI composition remains explicit and backward compatible", () => {
  const provider = createModelProviderFromEnvironment({ NUSA_AI_ENABLED: "true", NUSA_AI_PROVIDER: "openai", NUSA_AI_OPENAI_API_KEY: "primary-openai-secret", NUSA_AI_MODEL: "gpt-primary" });
  assert.deepEqual(describeModelProvider(provider), { status: "CONFIGURED", providerId: "openai", modelVersionId: "gpt-primary", credentialMaterialExposed: false });
  assert.equal(JSON.stringify(provider).includes("primary-openai-secret"), false);
});

test("Anthropic can be selected as a primary provider without changing authority surface", () => {
  const provider = createModelProviderFromEnvironment({ NUSA_AI_ENABLED: "true", NUSA_AI_PROVIDER: "anthropic", NUSA_AI_ANTHROPIC_API_KEY: "primary-anthropic-secret", NUSA_AI_MODEL: "claude-primary" });
  assert.deepEqual(describeModelProvider(provider), { status: "CONFIGURED", providerId: "anthropic", modelVersionId: "claude-primary", credentialMaterialExposed: false });
  assert.equal(JSON.stringify(provider).includes("primary-anthropic-secret"), false);
});

test("N-version pool is disabled unless separately and explicitly enabled", () => {
  assert.equal(createNVersionProviderPoolFromEnvironment(fullEnv({ NUSA_AI_NVERSION_ENABLED: "false" })), null);
  assert.equal(createNVersionProviderPoolFromEnvironment(fullEnv({ NUSA_AI_ENABLED: "false" })), null);
});

test("N-version pool fails closed when any independent model, credential, or family identity is missing", () => {
  for (const missing of [
    "NUSA_AI_OPENAI_API_KEY",
    "NUSA_AI_OPENAI_MODEL",
    "NUSA_AI_OPENAI_FAMILY_ID",
    "NUSA_AI_ANTHROPIC_API_KEY",
    "NUSA_AI_ANTHROPIC_MODEL",
    "NUSA_AI_ANTHROPIC_FAMILY_ID"
  ]) {
    const env = fullEnv();
    delete env[missing];
    assert.equal(createNVersionProviderPoolFromEnvironment(env), null, `${missing} must be mandatory`);
  }
});

test("fully configured N-version pool exposes only public lineage metadata under accidental serialization", () => {
  const env = fullEnv();
  const pool = createNVersionProviderPoolFromEnvironment(env);
  assert.ok(pool);
  assert.equal(pool.status, "CONFIGURED");
  assert.equal(pool.credentialMaterialExposed, false);
  assert.deepEqual(pool.groups.map(({ groupId, providerId, modelVersionId, modelFamilyId }) => ({ groupId, providerId, modelVersionId, modelFamilyId })), [
    { groupId: "openai-independent", providerId: "openai", modelVersionId: "gpt-independent-test", modelFamilyId: "openai-gpt-family" },
    { groupId: "anthropic-independent", providerId: "anthropic", modelVersionId: "claude-independent-test", modelFamilyId: "anthropic-claude-family" }
  ]);
  const serialized = JSON.stringify(pool);
  assert.equal(serialized.includes(env.NUSA_AI_OPENAI_API_KEY), false);
  assert.equal(serialized.includes(env.NUSA_AI_ANTHROPIC_API_KEY), false);
  assert.equal(serialized.includes("apiKey"), false);
});
