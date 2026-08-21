const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildDisagreementExplanationPrompt,
  explainChallengerDisagreement,
  createAnthropicDisagreementExplainerClient
} = require("../dist/apps/desktop/src/ai/aiChallengerDisagreementExplainer.js");

function observation(overrides = {}) {
  return {
    timestamp: 1000,
    market: "KRW-BTC",
    championSignal: { type: "BUY", reason: "short-SMA crossed above long-SMA" },
    aiSignal: { type: "SELL", reason: "하락 압력", confidence: 0.6 },
    agreesWithChampion: false,
    ...overrides
  };
}

test("buildDisagreementExplanationPrompt includes both signals and their reasons", () => {
  const prompt = buildDisagreementExplanationPrompt({
    market: "KRW-BTC",
    championSignal: { type: "BUY", reason: "short-SMA crossed above long-SMA" },
    aiSignal: { type: "SELL", reason: "하락 압력", confidence: 0.6 }
  });
  assert.ok(prompt.includes("Champion signal: BUY (short-SMA crossed above long-SMA)"));
  assert.ok(prompt.includes("AI challenger signal: SELL (하락 압력, confidence 0.60)"));
  assert.ok(prompt.includes("PAPER-TRADING"));
});

test("explainChallengerDisagreement reports NOT_CONFIGURED when no client is wired", async () => {
  const result = await explainChallengerDisagreement({ observation: observation(), client: undefined, nowMs: 5000 });
  assert.equal(result.status, "NOT_CONFIGURED");
});

test("explainChallengerDisagreement reports NO_DISAGREEMENT when there is no observation yet", async () => {
  const client = { explainDisagreement: async () => "should not be called" };
  const result = await explainChallengerDisagreement({ observation: undefined, client, nowMs: 5000 });
  assert.equal(result.status, "NO_DISAGREEMENT");
});

test("explainChallengerDisagreement reports NO_DISAGREEMENT when the latest observation actually agreed", async () => {
  const client = { explainDisagreement: async () => "should not be called" };
  const result = await explainChallengerDisagreement({ observation: observation({ agreesWithChampion: true }), client, nowMs: 5000 });
  assert.equal(result.status, "NO_DISAGREEMENT");
});

test("explainChallengerDisagreement returns OK with the client's explanation", async () => {
  const client = { explainDisagreement: async () => "설명입니다" };
  const result = await explainChallengerDisagreement({ observation: observation(), client, nowMs: 5000 });
  assert.equal(result.status, "OK");
  assert.equal(result.explanation, "설명입니다");
});

test("explainChallengerDisagreement reports UNAVAILABLE instead of throwing when the client fails", async () => {
  const client = { explainDisagreement: async () => { throw new Error("network down"); } };
  const result = await explainChallengerDisagreement({ observation: observation(), client, nowMs: 5000 });
  assert.equal(result.status, "UNAVAILABLE");
});

test("createAnthropicDisagreementExplainerClient sends the prompt and returns the text block", async () => {
  let capturedInit;
  const fetchImpl = async (_url, init) => {
    capturedInit = init;
    return { ok: true, json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "불일치 설명" }] }) };
  };
  const client = createAnthropicDisagreementExplainerClient({ apiKey: "hunter2hunter2", fetchImpl });
  const explanation = await client.explainDisagreement({
    market: "KRW-BTC",
    championSignal: { type: "BUY", reason: "x" },
    aiSignal: { type: "SELL", reason: "y", confidence: 0.5 }
  });
  assert.equal(explanation, "불일치 설명");
  const body = JSON.parse(capturedInit.body);
  assert.equal(body.model, "claude-opus-5");
});

test("createAnthropicDisagreementExplainerClient throws on a non-ok HTTP response", async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const client = createAnthropicDisagreementExplainerClient({ apiKey: "hunter2hunter2", fetchImpl });
  await assert.rejects(() => client.explainDisagreement({ market: "KRW-BTC", championSignal: { type: "BUY", reason: "x" }, aiSignal: { type: "SELL", reason: "y", confidence: 0.5 } }));
});

test("createAnthropicDisagreementExplainerClient throws when the API declines the request", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ stop_reason: "refusal", content: [] }) });
  const client = createAnthropicDisagreementExplainerClient({ apiKey: "hunter2hunter2", fetchImpl });
  await assert.rejects(() => client.explainDisagreement({ market: "KRW-BTC", championSignal: { type: "BUY", reason: "x" }, aiSignal: { type: "SELL", reason: "y", confidence: 0.5 } }));
});
