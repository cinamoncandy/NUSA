const test = require("node:test");
const assert = require("node:assert/strict");
const { JevShadowProvider, createJevShadowProviderFromEnvironment } = require("../dist/apps/cloud/src/ai/jevShadowProvider.js");
const { JevShadowRouter, JEV_DETERMINISTIC_FALLBACK } = require("../dist/apps/cloud/src/ai/jevShadowRouter.js");

const secret = () => ["unit", "jev", "credential"].join("-");
const decision = () => ({ rootCause: "CODE", safeToAutofix: "NO", severity: 3, requiredModel: "SOL", confidence: 0.91 });
const response = (body, ok = true, status = 200) => ({ ok, status, async text() { return typeof body === "string" ? body : JSON.stringify(body); } });

test("Jev provider is optional and disabled/missing credentials preserve existing path", () => {
  assert.equal(createJevShadowProviderFromEnvironment({}), null);
  assert.equal(createJevShadowProviderFromEnvironment({ NUSA_JEV_SHADOW_ENABLED: "true" }), null);
  assert.equal(createJevShadowProviderFromEnvironment({ NUSA_JEV_SHADOW_ENABLED: "true", NUSA_JEV_API_KEY: secret() }), null);
  assert.equal(createJevShadowProviderFromEnvironment({ NUSA_JEV_SHADOW_ENABLED: "true", NUSA_JEV_API_KEY: secret(), NUSA_JEV_ENDPOINT: "https://jev.invalid/classify", NUSA_JEV_TIMEOUT_MS: "bad" }), null);
});

test("Jev provider sends shadow zero-authority input without putting secret in body", async () => {
  const capture = {};
  const provider = new JevShadowProvider({
    apiKey: secret(),
    endpoint: "https://jev.invalid/classify",
    fetchImpl: async (url, init) => { capture.url = url; capture.init = init; return response(decision()); }
  });
  assert.deepEqual(await provider.classify({ failure: "test" }), decision());
  assert.equal(capture.url, "https://jev.invalid/classify");
  assert.equal(capture.init.headers.Authorization, `Bearer ${secret()}`);
  assert.equal(capture.init.body.includes(secret()), false);
  assert.deepEqual(JSON.parse(capture.init.body), { input: { failure: "test" }, authority: "ZERO_AUTHORITY", mode: "SHADOW" });
});

test("HTTP and network failures are sanitized and shadow router falls back", async () => {
  const key = secret();
  for (const fetchImpl of [
    async () => response("no", false, 503),
    async () => { throw new Error(`network ${key}`); }
  ]) {
    const provider = new JevShadowProvider({ apiKey: key, endpoint: "https://jev.invalid/classify", fetchImpl });
    const router = new JevShadowRouter((input) => provider.classify(input));
    const result = await router.observe({}, { NUSA_JEV_SHADOW_ENABLED: "true" });
    assert.deepEqual(result.decision, JEV_DETERMINISTIC_FALLBACK);
    assert.equal(result.usableForRouting, false);
    assert.equal(JSON.stringify(result).includes(key), false);
  }
});

test("malformed provider response cannot escape validation", async () => {
  const provider = new JevShadowProvider({ apiKey: secret(), endpoint: "https://jev.invalid/classify", fetchImpl: async () => response("{") });
  const router = new JevShadowRouter((input) => provider.classify(input));
  const result = await router.observe({}, { NUSA_JEV_SHADOW_ENABLED: "true" });
  assert.deepEqual(result.decision, JEV_DETERMINISTIC_FALLBACK);
  assert.equal(result.fallbackApplied, true);
});

test("provider timeout is bounded and cannot block the existing NUSA path", async () => {
  const provider = new JevShadowProvider({
    apiKey: secret(),
    endpoint: "https://jev.invalid/classify",
    timeoutMs: 100,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => { const error = new Error("aborted"); error.name = "AbortError"; reject(error); }, { once: true });
    })
  });
  const router = new JevShadowRouter((input) => provider.classify(input));
  const result = await router.observe({}, { NUSA_JEV_SHADOW_ENABLED: "true" });
  assert.deepEqual(result.decision, JEV_DETERMINISTIC_FALLBACK);
  assert.equal(result.usableForRouting, false);
});
