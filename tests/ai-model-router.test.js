const test = require("node:test");
const assert = require("node:assert/strict");
const { routeAiModel, validateAiModelRegistry } = require("../dist/apps/cloud/src/ai/modelRouter.js");

const entry = (modelId, overrides = {}) => ({
  modelId,
  providerId: `provider-${modelId.toLowerCase()}`,
  capabilities: ["classify", "route", "summarize", "code", "debug", "research", "architecture", "high_reasoning"],
  maxContextBytes: 1_000_000,
  costClass: modelId === "JEV" ? "ULTRA_LOW" : modelId === "LUNA" ? "LOW" : modelId === "TERRA" ? "MEDIUM" : "HIGH",
  latencyClass: modelId === "JEV" ? "ULTRA_LOW" : modelId === "LUNA" ? "LOW" : "MEDIUM",
  availability: "AVAILABLE",
  enabled: true,
  stability: modelId === "JEV" ? "EXPERIMENTAL" : "STABLE",
  ...overrides
});
const registry = () => ["JEV", "LUNA", "TERRA", "SOL", "ASTRA"].map((model) => entry(model));
const input = (overrides = {}) => ({
  taskType: "summarize", riskLevel: "LOW", estimatedComplexity: "SIMPLE", contextSize: 100,
  requiredCapabilities: [], latencySensitivity: "MEDIUM", costSensitivity: "HIGH",
  previousFailures: [], confidence: 0.9, ...overrides
});

test("experimental Jev cannot become active route and simple work selects Luna", () => {
  const result = routeAiModel(input(), registry());
  assert.equal(result.selectedModel, "LUNA");
  assert.equal(result.aiAuthority, "ZERO_AUTHORITY");
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
});

test("complex and high-risk work escalates without cost overriding capability", () => {
  assert.equal(routeAiModel(input({ taskType: "debug", estimatedComplexity: "COMPLEX" }), registry()).selectedModel, "SOL");
  assert.equal(routeAiModel(input({ riskLevel: "CRITICAL" }), registry()).selectedModel, "ASTRA");
});

test("low confidence escalates upward and records escalation", () => {
  const result = routeAiModel(input({ confidence: 0.2 }), registry());
  assert.equal(result.selectedModel, "SOL");
  assert.equal(result.reasonCode, "LOW_CONFIDENCE_ESCALATION");
  assert.equal(result.escalationRequired, true);
});

test("unavailable, failed, capability-mismatched and context-insufficient models are excluded", () => {
  const models = registry().map((model) => model.modelId === "LUNA" ? entry("LUNA", { availability: "UNAVAILABLE" }) : model);
  assert.equal(routeAiModel(input(), models).selectedModel, "TERRA");
  assert.equal(routeAiModel(input({ previousFailures: ["LUNA", "TERRA"] }), registry()).selectedModel, "SOL");
  assert.equal(routeAiModel(input({ taskType: "code" }), [entry("LUNA", { capabilities: ["summarize"] })]).selectedModel, "HUMAN");
  assert.equal(routeAiModel(input({ contextSize: 2_000_000 }), registry()).selectedModel, "HUMAN");
});

test("fallback never lowers the selected capability floor and exhaustion fails closed", () => {
  const result = routeAiModel(input({ estimatedComplexity: "COMPLEX" }), registry());
  assert.equal(result.selectedModel, "SOL");
  assert.equal(result.fallbackModel, "ASTRA");
  const exhausted = routeAiModel(input({ riskLevel: "CRITICAL", previousFailures: ["ASTRA"] }), registry());
  assert.equal(exhausted.selectedModel, "HUMAN");
  assert.equal(exhausted.selectedProvider, null);
  assert.equal(exhausted.maxRetries, 0);
  assert.equal(exhausted.escalationRequired, true);
});

test("registry validation rejects duplicate identities and invalid context", () => {
  assert.throws(() => validateAiModelRegistry([entry("LUNA"), entry("LUNA")]), /duplicate/);
  assert.throws(() => validateAiModelRegistry([entry("LUNA", { maxContextBytes: 0 })]), /context/);
});
