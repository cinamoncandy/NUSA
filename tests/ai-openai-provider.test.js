const test = require("node:test");
const assert = require("node:assert/strict");
const { aiSha256 } = require("../dist/packages/contracts/src/aiInference.js");
const { AgentExecutor } = require("../dist/apps/cloud/src/ai/agentExecutor.js");
const {
  createModelProviderFromEnvironment,
  describeModelProvider,
  UnavailableModelProvider
} = require("../dist/apps/cloud/src/ai/modelProvider.js");
const {
  OpenAiResponsesModelProvider,
  openAiStructuredOutputSchema
} = require("../dist/apps/cloud/src/ai/openAiResponsesModelProvider.js");

const sha = (character) => character.repeat(64);
const keyName = ["NUSA", "AI", "OPENAI", "API", "KEY"].join("_");
const secret = () => ["unit", "provider", "credential"].join("-");

const request = (overrides = {}) => ({
  requestId: "run-1:request:EVIDENCE_PRODUCER",
  role: "EVIDENCE_PRODUCER",
  providerId: "openai",
  modelVersionId: "gpt-test-snapshot",
  promptArtifactId: "nusa.ai.evidence_producer",
  promptArtifactVersion: "1.0.0",
  promptArtifactDigest: sha("a"),
  instructions: "Use only the supplied evidence and return the required structured output.",
  contextHash: sha("b"),
  inputHash: sha("c"),
  input: Object.freeze({ role: "EVIDENCE_PRODUCER", evidenceBundleHash: sha("d"), evidence: [] }),
  maxOutputBytes: 32768,
  maxTokens: 2048,
  timeoutMs: 1000,
  attempt: 0,
  ...overrides
});

const structuredOutput = () => ({
  schemaVersion: 1,
  role: "EVIDENCE_PRODUCER",
  evidenceReferences: [],
  payload: {
    observations: [],
    missingEvidence: [],
    evidenceBundleHash: sha("d")
  }
});

const envelope = (output = structuredOutput(), overrides = {}) => ({
  status: "completed",
  model: "gpt-test-snapshot",
  output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(output) }] }],
  usage: { input_tokens: 37, output_tokens: 19, total_tokens: 56 },
  ...overrides
});

const response = (body, ok = true, status = 200) => ({
  ok,
  status,
  async text() { return typeof body === "string" ? body : JSON.stringify(body); }
});

const providerFor = (body, capture = {}) => {
  let tick = 1000;
  return new OpenAiResponsesModelProvider({
    apiKey: secret(),
    modelVersionId: "gpt-test-snapshot",
    now: () => tick++,
    fetchImpl: async (url, init) => {
      capture.url = url;
      capture.init = init;
      return response(body);
    }
  });
};

test("provider factory stays unavailable unless AI, provider, model, and environment credential are all explicit", () => {
  assert.ok(createModelProviderFromEnvironment({}) instanceof UnavailableModelProvider);
  assert.ok(createModelProviderFromEnvironment({ NUSA_AI_ENABLED: "true" }) instanceof UnavailableModelProvider);
  assert.ok(createModelProviderFromEnvironment({ NUSA_AI_ENABLED: "true", NUSA_AI_PROVIDER: "other", NUSA_AI_MODEL: "gpt-test-snapshot" }) instanceof UnavailableModelProvider);
  const missingCredential = { NUSA_AI_ENABLED: "true", NUSA_AI_PROVIDER: "openai", NUSA_AI_MODEL: "gpt-test-snapshot" };
  assert.ok(createModelProviderFromEnvironment(missingCredential) instanceof UnavailableModelProvider);
  const configured = { NUSA_AI_ENABLED: "true", NUSA_AI_PROVIDER: "openai", NUSA_AI_MODEL: "gpt-test-snapshot" };
  configured[keyName] = secret();
  const provider = createModelProviderFromEnvironment(configured);
  assert.ok(provider instanceof OpenAiResponsesModelProvider);
  assert.deepEqual(describeModelProvider(provider), {
    status: "CONFIGURED",
    providerId: "openai",
    modelVersionId: "gpt-test-snapshot",
    credentialMaterialExposed: false
  });
  assert.equal(JSON.stringify(describeModelProvider(provider)).includes(secret()), false);
});

test("OpenAI challenger uses only Responses strict structured output and returns identity plus token usage", async () => {
  const capture = {};
  const provider = providerFor(envelope(), capture);
  const req = request();
  const result = await provider.infer(req);
  assert.equal(capture.url, "https://api.openai.com/v1/responses");
  assert.equal(capture.init.method, "POST");
  assert.equal(capture.init.headers.Authorization, `Bearer ${secret()}`);
  const body = JSON.parse(capture.init.body);
  assert.equal(body.model, req.modelVersionId);
  assert.equal(body.instructions, req.instructions);
  assert.equal(body.store, false);
  assert.deepEqual(body.tools, []);
  assert.equal(body.max_output_tokens, req.maxTokens);
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.strict, true);
  assert.deepEqual(body.text.format.schema, openAiStructuredOutputSchema(req.role));
  assert.equal(body.input[0].content[0].text, JSON.stringify(req.input));
  assert.equal(capture.init.body.includes(secret()), false);
  assert.equal(result.requestId, req.requestId);
  assert.equal(result.providerId, "openai");
  assert.equal(result.modelVersionId, req.modelVersionId);
  assert.equal(result.promptArtifactDigest, req.promptArtifactDigest);
  assert.equal(result.contextHash, req.contextHash);
  assert.equal(result.inputHash, req.inputHash);
  assert.deepEqual(result.structuredOutput, structuredOutput());
  assert.equal(result.outputHash, aiSha256(structuredOutput()));
  assert.deepEqual(result.usage, { inputTokens: 37, outputTokens: 19, totalTokens: 56 });
  assert.equal(result.startedAt, 1000);
  assert.equal(result.completedAt, 1001);
});

test("strict schemas exist for all four zero-authority roles", () => {
  for (const role of ["EVIDENCE_PRODUCER", "STRATEGY_PROPOSER", "ADVERSARIAL_CRITIC", "RISK_VERIFIER"]) {
    const schema = openAiStructuredOutputSchema(role);
    assert.equal(schema.type, "object");
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.properties.role.enum, [role]);
    assert.equal(schema.properties.payload.additionalProperties, false);
  }
});

test("provider fails closed on incomplete, refusal, model mismatch, malformed output, and malformed usage", async () => {
  await assert.rejects(providerFor(envelope(structuredOutput(), { status: "incomplete" })).infer(request()), /incomplete/i);
  await assert.rejects(providerFor(envelope(structuredOutput(), { model: "different-model" })).infer(request()), /model mismatch/i);
  await assert.rejects(providerFor({ ...envelope(), output: [{ type: "message", content: [{ type: "refusal", refusal: "cannot comply" }] }] }).infer(request()), /refused/i);
  await assert.rejects(providerFor({ ...envelope(), output: [{ type: "message", content: [{ type: "output_text", text: "{" }] }] }).infer(request()), (error) => error && error.name === "MalformedModelOutputError");
  await assert.rejects(providerFor({ ...envelope(), usage: { input_tokens: 1, output_tokens: "bad", total_tokens: 1 } }).infer(request()), /usage/i);
});

test("provider HTTP and network failures are sanitized and never contain credential material", async () => {
  const key = secret();
  const httpProvider = new OpenAiResponsesModelProvider({
    apiKey: key,
    modelVersionId: "gpt-test-snapshot",
    fetchImpl: async () => response("not returned", false, 503)
  });
  await assert.rejects(httpProvider.infer(request()), (error) => {
    assert.equal(String(error).includes(key), false);
    return /HTTP failure 503/.test(String(error));
  });
  const networkProvider = new OpenAiResponsesModelProvider({
    apiKey: key,
    modelVersionId: "gpt-test-snapshot",
    fetchImpl: async () => { throw new Error(`network failed ${key}`); }
  });
  await assert.rejects(networkProvider.infer(request()), (error) => {
    assert.equal(String(error).includes(key), false);
    return /provider unavailable/i.test(String(error));
  });
});

test("provider aborts its network request at the bounded request timeout", async () => {
  const provider = new OpenAiResponsesModelProvider({
    apiKey: secret(),
    modelVersionId: "gpt-test-snapshot",
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    })
  });
  await assert.rejects(provider.infer(request({ timeoutMs: 10 })), (error) => error && error.name === "TimeoutError");
});

test("provider and executor classify oversized and malformed model output without authority", async () => {
  const tooLarge = JSON.stringify({ ...structuredOutput(), payload: { ...structuredOutput().payload, padding: "x".repeat(1000) } });
  const oversizedProvider = providerFor({ ...envelope(), output: [{ type: "message", content: [{ type: "output_text", text: tooLarge }] }] });
  const oversizedExecutor = new AgentExecutor(oversizedProvider, 0);
  const oversized = await oversizedExecutor.execute(request({ maxOutputBytes: 100 }), (value) => value);
  assert.equal(oversized.ok, false);
  assert.equal(oversized.failure.code, "OUTPUT_TOO_LARGE");

  const malformedProvider = providerFor({ ...envelope(), output: [{ type: "message", content: [{ type: "output_text", text: "not-json" }] }] });
  const malformedExecutor = new AgentExecutor(malformedProvider, 0);
  const malformed = await malformedExecutor.execute(request(), (value) => value);
  assert.equal(malformed.ok, false);
  assert.equal(malformed.failure.code, "MALFORMED_OUTPUT");
});
