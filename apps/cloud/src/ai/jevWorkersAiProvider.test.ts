import assert from "node:assert/strict";
import test from "node:test";
import { JevWorkersAiProvider } from "./jevWorkersAiProvider";

const MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";

function decisionResponse(overrides: Record<string, unknown> = {}) {
  return {
    response: JSON.stringify({
      rootCause: "CODE",
      safeToAutofix: "NO",
      severity: 3,
      requiredModel: "TERRA",
      confidence: 0.82,
      ...overrides,
    }),
    usage: { prompt_tokens: 12, completion_tokens: 7 },
  };
}

function runtime(response: unknown, calls?: Array<unknown>) {
  return {
    async run(model: string, input: { prompt: string; response_format?: unknown }) {
      calls?.push({ model, input });
      if (response instanceof Error) throw response;
      return response;
    },
  };
}

test("classifies through the native Workers AI binding with a typed receipt", async () => {
  const calls: Array<{ model: string; input: { prompt: string; response_format?: unknown } }> = [];
  const provider = new JevWorkersAiProvider({ ai: runtime(decisionResponse(), calls), model: MODEL, now: () => 1000 });
  const result = await provider.classifyDetailed({ taskType: "WORKFLOW_FAILURE_CLASSIFICATION", failure: "unit-test-failed" });
  assert.equal(result.decision.rootCause, "CODE");
  assert.equal(result.decision.confidence, 0.82);
  assert.equal(result.receipt.provider, "workers-ai");
  assert.equal(result.receipt.model, MODEL);
  assert.equal(result.receipt.reasonCode, "SUCCESS");
  assert.equal(result.receipt.promptTokens, 12);
  assert.equal(result.receipt.completionTokens, 7);
  assert.equal(result.receipt.fallbackApplied, false);
  assert.equal(result.receipt.liveAuthority, "NONE");
  assert.equal(result.receipt.productionMutationAllowed, false);
  assert.equal(result.receipt.aiAuthority, "ZERO_AUTHORITY");
  assert.equal(result.receipt.inputFingerprint.length, 64);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.model, MODEL);
  assert.match(String(calls[0]?.input.prompt), /zero-authority/i);
});

test("classify returns the decision alone for router compatibility", async () => {
  const provider = new JevWorkersAiProvider({ ai: runtime(decisionResponse()), model: MODEL });
  const decision = await provider.classify({ taskType: "T" });
  assert.equal(decision.requiredModel, "TERRA");
});

test("sends no API key, bearer token, or credential", async () => {
  const seen: string[] = [];
  const ai = { async run(model: string, input: { prompt: string }) { seen.push(`${model} ${input.prompt} ${JSON.stringify(input)}`); return decisionResponse(); } };
  const provider = new JevWorkersAiProvider({ ai, model: MODEL });
  await provider.classify({ taskType: "T", note: "plain metadata" });
  const serialized = seen.join(" ");
  assert.equal(/api[_-]?key|bearer|refresh[_-]?token|private[_-]?key/i.test(serialized), false);
});

test("times out instead of hanging on a silent provider", async () => {
  const ai = { async run() { await new Promise(() => undefined); return decisionResponse(); } };
  const provider = new JevWorkersAiProvider({ ai, model: MODEL, timeoutMs: 100 });
  await assert.rejects(provider.classify({ taskType: "T" }), /timed out/);
});

test("transport failures surface as provider-unavailable without inventing a decision", async () => {
  const provider = new JevWorkersAiProvider({ ai: runtime(new Error("fetch failed")), model: MODEL });
  await assert.rejects(provider.classify({ taskType: "T" }), /unavailable/i);
});

test("quota-shaped errors keep their canonical reason for provider governance", async () => {
  const provider = new JevWorkersAiProvider({ ai: runtime(new Error("4006: you have used up your daily free allocation of 100,000 neurons")), model: MODEL });
  await assert.rejects(provider.classify({ taskType: "T" }), /daily free allocation/);
});

test("malformed model output fails closed instead of fabricating a decision", async () => {
  const provider = new JevWorkersAiProvider({ ai: runtime({ response: "not json" }), model: MODEL });
  await assert.rejects(provider.classify({ taskType: "T" }), /malformed/i);
  const wrongKeys = new JevWorkersAiProvider({ ai: runtime({ response: JSON.stringify({ verdict: "PASS" }) }), model: MODEL });
  await assert.rejects(wrongKeys.classify({ taskType: "T" }), /malformed/i);
});

test("accepts current structured chat-completion response envelopes", async () => {
  const parsed = { rootCause: "INFRA", safeToAutofix: "NO", severity: 2, requiredModel: "LUNA", confidence: 0.91 };
  const structured = new JevWorkersAiProvider({
    ai: runtime({ choices: [{ message: { parsed } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }),
    model: MODEL,
  });
  assert.equal((await structured.classify({ taskType: "T" })).rootCause, "INFRA");

  const textual = new JevWorkersAiProvider({
    ai: runtime({ choices: [{ message: { content: JSON.stringify(parsed) } }] }),
    model: MODEL,
  });
  assert.equal((await textual.classify({ taskType: "T" })).requiredModel, "LUNA");
});

test("preserves retry metadata on provider errors", async () => {
  const rateLimit = Object.assign(new Error("429 rate limited"), { retryAfterMs: 60_000, resetAt: 123456 });
  const provider = new JevWorkersAiProvider({ ai: runtime(rateLimit), model: MODEL });
  await assert.rejects(provider.classify({ taskType: "T" }), (error: unknown) => {
    const record = error as Error & { retryAfterMs?: number; resetAt?: number; cause?: unknown };
    assert.equal(record.name, "JevProviderUnavailableError");
    assert.equal(record.retryAfterMs, 60_000);
    assert.equal(record.resetAt, 123456);
    assert.equal(record.cause, rateLimit);
    return true;
  });
});

test("low-confidence decisions pass through unmodified; gating stays in the router", async () => {
  const provider = new JevWorkersAiProvider({ ai: runtime(decisionResponse({ confidence: 0.05 })), model: MODEL });
  const decision = await provider.classify({ taskType: "T" });
  assert.equal(decision.confidence, 0.05);
});

test("concurrent semantically identical requests coalesce regardless of key order", async () => {
  let calls = 0;
  const ai = { async run() { calls += 1; await new Promise((resolve) => setTimeout(resolve, 20)); return decisionResponse(); } };
  const provider = new JevWorkersAiProvider({ ai, model: MODEL });
  const [first, second] = await Promise.all([
    provider.classifyDetailed({ taskType: "T", nested: { z: 1, a: 2 }, id: "same" }),
    provider.classifyDetailed({ id: "same", nested: { a: 2, z: 1 }, taskType: "T" }),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(first.receipt.inputFingerprint, second.receipt.inputFingerprint);
  assert.equal(first.decision.confidence, second.decision.confidence);
});

test("timed-out calls remain coalesced until the underlying binding settles", async () => {
  let calls = 0;
  let settle!: (value: unknown) => void;
  const ai = {
    run() {
      calls += 1;
      if (calls > 1) return Promise.resolve(decisionResponse());
      return new Promise<unknown>((resolve) => { settle = resolve; });
    },
  };
  const provider = new JevWorkersAiProvider({ ai, model: MODEL, timeoutMs: 100 });
  const input = { taskType: "T", id: "slow" };
  const first = provider.classify(input);
  await assert.rejects(first, /timed out/);
  await assert.rejects(provider.classify({ id: "slow", taskType: "T" }), /timed out/);
  assert.equal(calls, 1);
  settle(decisionResponse());
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((await provider.classify(input)).rootCause, "CODE");
  assert.equal(calls, 2);
});

test("invalid input and options fail closed", async () => {
  const provider = new JevWorkersAiProvider({ ai: runtime(decisionResponse()), model: MODEL });
  await assert.rejects(provider.classify(null as never), /input invalid/);
  await assert.rejects(provider.classify([] as never), /input invalid/);
  assert.throws(() => new JevWorkersAiProvider({ ai: null as never, model: MODEL }), /runtime invalid/);
  assert.throws(() => new JevWorkersAiProvider({ ai: runtime(decisionResponse()), model: "  " }), /model invalid/);
  assert.throws(() => new JevWorkersAiProvider({ ai: runtime(decisionResponse()), model: MODEL, timeoutMs: 5 }), /timeout invalid/);
});
