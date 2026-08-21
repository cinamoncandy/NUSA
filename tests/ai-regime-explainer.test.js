const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildRegimeExplanationPrompt,
  explainRegime,
  createAnthropicRegimeExplainerClient
} = require("../dist/apps/desktop/src/ai/aiRegimeExplainer.js");

function request(overrides = {}) {
  return {
    market: "KRW-BTC",
    regime: "STRONG_UPTREND",
    recentPrices: [100, 101, 105, 110],
    decision: {
      strategyId: "sma-crossover",
      regime: "STRONG_UPTREND",
      preference: "PREFERRED",
      allowNewExposure: true,
      risk: { positionSizeMultiplier: 1, maximumExposureMultiplier: 1, dailyRiskMultiplier: 1, stopLossMultiplier: 1, takeProfitMultiplier: 1, orderFrequencyMultiplier: 1 },
      reason: "TREND_REGIME_SUPPORTED"
    },
    ...overrides
  };
}

test("buildRegimeExplanationPrompt includes the regime, prices, and decision fields", () => {
  const prompt = buildRegimeExplanationPrompt(request());
  assert.ok(prompt.includes("Regime: STRONG_UPTREND"));
  assert.ok(prompt.includes("100, 101, 105, 110"));
  assert.ok(prompt.includes("Strategy preference: PREFERRED"));
  assert.ok(prompt.includes("New exposure currently allowed: true"));
  assert.ok(prompt.includes("Reason code: TREND_REGIME_SUPPORTED"));
  assert.ok(prompt.includes("PAPER-TRADING"));
});

test("buildRegimeExplanationPrompt includes the risk multipliers", () => {
  const prompt = buildRegimeExplanationPrompt(request({
    decision: { ...request().decision, risk: { ...request().decision.risk, positionSizeMultiplier: 0.25, maximumExposureMultiplier: 0.25, orderFrequencyMultiplier: 0.25 } }
  }));
  assert.ok(prompt.includes("Position size multiplier: 0.25"));
  assert.ok(prompt.includes("Maximum exposure multiplier: 0.25"));
  assert.ok(prompt.includes("Order frequency multiplier: 0.25"));
});

test("explainRegime reports NOT_CONFIGURED when no client is wired", async () => {
  const result = await explainRegime({ request: request(), client: undefined, nowMs: 5000 });
  assert.equal(result.status, "NOT_CONFIGURED");
});

test("explainRegime reports NO_REGIME when there is no request", async () => {
  const client = { explainRegime: async () => "should not be called" };
  const result = await explainRegime({ request: undefined, client, nowMs: 5000 });
  assert.equal(result.status, "NO_REGIME");
});

test("explainRegime returns OK with the client's explanation", async () => {
  const client = { explainRegime: async () => "레짐 설명입니다" };
  const result = await explainRegime({ request: request(), client, nowMs: 5000 });
  assert.equal(result.status, "OK");
  assert.equal(result.explanation, "레짐 설명입니다");
});

test("explainRegime reports UNAVAILABLE instead of throwing when the client fails", async () => {
  const client = { explainRegime: async () => { throw new Error("network down"); } };
  const result = await explainRegime({ request: request(), client, nowMs: 5000 });
  assert.equal(result.status, "UNAVAILABLE");
});

test("createAnthropicRegimeExplainerClient sends the prompt and returns the text block", async () => {
  let capturedInit;
  const fetchImpl = async (_url, init) => {
    capturedInit = init;
    return { ok: true, json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "레짐 설명입니다" }] }) };
  };
  const client = createAnthropicRegimeExplainerClient({ apiKey: "hunter2hunter2", fetchImpl });
  const explanation = await client.explainRegime(request());
  assert.equal(explanation, "레짐 설명입니다");
  const body = JSON.parse(capturedInit.body);
  assert.equal(body.model, "claude-opus-5");
  assert.ok(body.messages[0].content.includes("Regime: STRONG_UPTREND"));
});

test("createAnthropicRegimeExplainerClient throws on a non-ok HTTP response", async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const client = createAnthropicRegimeExplainerClient({ apiKey: "hunter2hunter2", fetchImpl });
  await assert.rejects(() => client.explainRegime(request()));
});

test("createAnthropicRegimeExplainerClient throws when the API declines the request", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ stop_reason: "refusal", content: [] }) });
  const client = createAnthropicRegimeExplainerClient({ apiKey: "hunter2hunter2", fetchImpl });
  await assert.rejects(() => client.explainRegime(request()));
});
