const test = require("node:test");
const assert = require("node:assert/strict");
const { aiSha256 } = require("../dist/packages/contracts/src/aiInference.js");
const { AnthropicMessagesModelProvider } = require("../dist/apps/cloud/src/ai/anthropicMessagesModelProvider.js");

const secret = "anthropic-secret-must-not-leak";
const structured = Object.freeze({
  schemaVersion: 1,
  role: "STRATEGY_PROPOSER",
  evidenceReferences: ["e-1"],
  payload: Object.freeze({
    strategyVersionId: "strategy-preview",
    decision: "candidate",
    rationaleClaims: ["evidence supports review"],
    assumptions: ["paper only"],
    uncertainty: "medium",
    rawProbability: 0.61,
    expectedEffect: "research only",
    costSensitivity: "unknown",
    capacitySensitivity: "unknown"
  })
});

const request = (overrides = {}) => Object.freeze({
  requestId: "anthropic-request-1",
  role: "STRATEGY_PROPOSER",
  providerId: "anthropic",
  modelVersionId: "claude-test",
  promptArtifactId: "nusa.ai.strategy_proposer",
  promptArtifactVersion: "1.0.0",
  promptArtifactDigest: "a".repeat(64),
  instructions: "Return only grounded structured evidence.",
  contextHash: "b".repeat(64),
  inputHash: "c".repeat(64),
  input: Object.freeze({ role: "STRATEGY_PROPOSER", evidence: [Object.freeze({ evidenceId: "e-1", value: 1 })] }),
  maxOutputBytes: 32_768,
  maxTokens: 2048,
  timeoutMs: 10_000,
  attempt: 0,
  ...overrides
});

const envelope = (overrides = {}) => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  model: "claude-test",
  content: [{ type: "text", text: JSON.stringify(structured) }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 10, cache_creation_input_tokens: 3, cache_read_input_tokens: 5, output_tokens: 7 },
  ...overrides
});

const response = (body, ok = true, status = 200) => ({ ok, status, text: async () => typeof body === "string" ? body : JSON.stringify(body) });

function provider(fetchImpl, times = [1000, 1100]) {
  let index = 0;
  return new AnthropicMessagesModelProvider({
    apiKey: secret,
    modelVersionId: "claude-test",
    fetchImpl,
    now: () => times[Math.min(index++, times.length - 1)]
  });
}

test("Anthropic adapter uses official Messages structured-output contract and secret only in x-api-key header", async () => {
  let captured;
  const subject = provider(async (url, init) => { captured = { url, init }; return response(envelope()); });
  const result = await subject.infer(request());
  assert.equal(captured.url, "https://api.anthropic.com/v1/messages");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers["x-api-key"], secret);
  assert.equal(captured.init.headers["anthropic-version"], "2023-06-01");
  assert.equal(captured.init.headers["content-type"], "application/json");
  assert.equal(captured.init.headers.Authorization, undefined);
  const body = JSON.parse(captured.init.body);
  assert.equal(body.model, "claude-test");
  assert.equal(body.max_tokens, 2048);
  assert.equal(body.system, request().instructions);
  assert.equal(body.output_config.format.type, "json_schema");
  assert.equal(body.output_config.format.schema.properties.role.enum[0], "STRATEGY_PROPOSER");
  assert.equal(body.tools, undefined);
  assert.equal(captured.init.body.includes(secret), false, "credential material must never enter provider request body");
  assert.deepEqual(result.structuredOutput, structured);
  assert.equal(result.outputHash, aiSha256(structured));
  assert.deepEqual(result.usage, { inputTokens: 18, outputTokens: 7, totalTokens: 25 });
  assert.equal(result.providerId, "anthropic");
  assert.equal(result.modelVersionId, "claude-test");
});

test("Anthropic usage accounting includes cache creation and cache read tokens", async () => {
  const subject = provider(async () => response(envelope({ usage: { input_tokens: 2, cache_creation_input_tokens: 11, cache_read_input_tokens: 13, output_tokens: 17 } })));
  const result = await subject.infer(request());
  assert.deepEqual(result.usage, { inputTokens: 26, outputTokens: 17, totalTokens: 43 });
});

test("Anthropic adapter accepts absent cache usage fields as zero but requires base input/output usage", async () => {
  const subject = provider(async () => response(envelope({ usage: { input_tokens: 2, output_tokens: 3 } })));
  const result = await subject.infer(request());
  assert.deepEqual(result.usage, { inputTokens: 2, outputTokens: 3, totalTokens: 5 });

  const malformed = provider(async () => response(envelope({ usage: { output_tokens: 3 } })));
  await assert.rejects(() => malformed.infer(request()), (error) => error.name === "MalformedModelOutputError");
});

test("Anthropic adapter fails closed on model mismatch and non-natural stop reasons", async () => {
  const mismatch = provider(async () => response(envelope({ model: "other-model" })));
  await assert.rejects(() => mismatch.infer(request()), /model mismatch/);
  for (const stop_reason of ["max_tokens", "tool_use", "pause_turn", "refusal", "model_context_window_exceeded"]) {
    const subject = provider(async () => response(envelope({ stop_reason })));
    await assert.rejects(() => subject.infer(request()), /incomplete/);
  }
});

test("Anthropic adapter rejects malformed, multiple, non-text, and invalid JSON content", async () => {
  const fixtures = [
    envelope({ content: [] }),
    envelope({ content: [{ type: "text", text: "{}" }, { type: "text", text: "{}" }] }),
    envelope({ content: [{ type: "tool_use", id: "tool-1" }] }),
    envelope({ content: [{ type: "text", text: "not-json" }] })
  ];
  for (const fixture of fixtures) {
    const subject = provider(async () => response(fixture));
    await assert.rejects(() => subject.infer(request()), (error) => error.name === "MalformedModelOutputError");
  }
});

test("Anthropic adapter enforces output byte ceiling", async () => {
  const subject = provider(async () => response(envelope()));
  await assert.rejects(() => subject.infer(request({ maxOutputBytes: 10 })), (error) => error.name === "OutputTooLargeError");
});

test("Anthropic network and HTTP failures are generic and never expose credential material", async () => {
  const network = provider(async () => { throw new Error(`network ${secret}`); });
  await assert.rejects(() => network.infer(request()), (error) => {
    assert.equal(error.message, "AI model provider unavailable");
    assert.equal(error.message.includes(secret), false);
    return true;
  });
  const http = provider(async () => response({ error: { message: secret } }, false, 429));
  await assert.rejects(() => http.infer(request()), (error) => {
    assert.equal(error.message, "AI model provider HTTP failure 429");
    assert.equal(error.message.includes(secret), false);
    return true;
  });
});

test("Anthropic AbortError maps to bounded timeout without credential leakage", async () => {
  const subject = provider(async () => { const error = new Error(secret); error.name = "AbortError"; throw error; });
  await assert.rejects(() => subject.infer(request()), (error) => {
    assert.equal(error.name, "TimeoutError");
    assert.equal(error.message.includes(secret), false);
    return true;
  });
});
