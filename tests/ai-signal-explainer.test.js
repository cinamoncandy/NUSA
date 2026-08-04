const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSignalExplanationPrompt,
  explainStrategySignal,
  createAnthropicSignalExplainerClient
} = require("../dist/apps/desktop/src/aiSignalExplainer.js");

function signal(overrides = {}) {
  return { type: "BUY", reason: "short-SMA crossed above long-SMA", confidence: 0.4, timestamp: 1000, ...overrides };
}

test("buildSignalExplanationPrompt includes the market, signal, and recent prices", () => {
  const prompt = buildSignalExplanationPrompt({ market: "KRW-BTC", signal: signal(), recentPrices: [100, 101, 102] });
  assert.ok(prompt.includes("KRW-BTC"));
  assert.ok(prompt.includes("BUY"));
  assert.ok(prompt.includes("short-SMA crossed above long-SMA"));
  assert.ok(prompt.includes("100, 101, 102"));
  assert.ok(prompt.includes("PAPER-TRADING"), "the prompt must declare it is read-only/paper-only context");
});

test("buildSignalExplanationPrompt includes the regime only when present", () => {
  const withRegime = buildSignalExplanationPrompt({ market: "KRW-BTC", signal: signal({ regime: "TRENDING" }), recentPrices: [] });
  assert.ok(withRegime.includes("Regime: TRENDING"));
  const withoutRegime = buildSignalExplanationPrompt({ market: "KRW-BTC", signal: signal(), recentPrices: [] });
  assert.ok(!withoutRegime.includes("Regime:"));
});

test("buildSignalExplanationPrompt caps the price window at the most recent 20", () => {
  const prices = Array.from({ length: 30 }, (_, i) => i);
  const prompt = buildSignalExplanationPrompt({ market: "KRW-BTC", signal: signal(), recentPrices: prices });
  assert.ok(!prompt.includes("0, 1, 2"));
  assert.ok(prompt.includes("10, 11, 12"));
  assert.ok(prompt.includes("28, 29"));
});

test("explainStrategySignal reports NOT_CONFIGURED when no client is wired", async () => {
  const result = await explainStrategySignal({ request: { market: "KRW-BTC", signal: signal(), recentPrices: [] }, client: undefined, nowMs: 5000 });
  assert.equal(result.status, "NOT_CONFIGURED");
  assert.equal(result.generatedAt, 5000);
});

test("explainStrategySignal reports NO_SIGNAL when no signal has fired yet", async () => {
  const client = { explain: async () => "should not be called" };
  const result = await explainStrategySignal({ request: undefined, client, nowMs: 5000 });
  assert.equal(result.status, "NO_SIGNAL");
});

test("explainStrategySignal returns OK with the explanation and echoes the signal identity", async () => {
  const client = { explain: async (request) => `${request.signal.type} 신호 설명` };
  const request = { market: "KRW-BTC", signal: signal(), recentPrices: [100] };
  const result = await explainStrategySignal({ request, client, nowMs: 5000 });
  assert.equal(result.status, "OK");
  assert.equal(result.explanation, "BUY 신호 설명");
  assert.deepEqual(result.signal, { type: "BUY", reason: "short-SMA crossed above long-SMA", timestamp: 1000 });
});

test("explainStrategySignal reports UNAVAILABLE instead of throwing when the client fails", async () => {
  const client = { explain: async () => { throw new Error("network down"); } };
  const request = { market: "KRW-BTC", signal: signal(), recentPrices: [] };
  const result = await explainStrategySignal({ request, client, nowMs: 5000 });
  assert.equal(result.status, "UNAVAILABLE");
  assert.ok(result.explanation.length > 0);
});

test("createAnthropicSignalExplainerClient sends the API key and prompt, and returns the text block", async () => {
  let capturedUrl;
  let capturedInit;
  const fetchImpl = async (url, init) => {
    capturedUrl = url;
    capturedInit = init;
    return {
      ok: true,
      json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "설명입니다" }] })
    };
  };
  const client = createAnthropicSignalExplainerClient({ apiKey: "hunter2hunter2", fetchImpl });
  const explanation = await client.explain({ market: "KRW-BTC", signal: signal(), recentPrices: [100] });
  assert.equal(explanation, "설명입니다");
  assert.equal(capturedUrl, "https://api.anthropic.com/v1/messages");
  assert.equal(capturedInit.headers["x-api-key"], "hunter2hunter2");
  const body = JSON.parse(capturedInit.body);
  assert.equal(body.model, "claude-opus-5");
  assert.ok(body.messages[0].content.includes("KRW-BTC"));
});

test("createAnthropicSignalExplainerClient throws on a non-ok HTTP response", async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const client = createAnthropicSignalExplainerClient({ apiKey: "hunter2hunter2", fetchImpl });
  await assert.rejects(() => client.explain({ market: "KRW-BTC", signal: signal(), recentPrices: [] }));
});

test("createAnthropicSignalExplainerClient throws when the API declines the request", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ stop_reason: "refusal", content: [] }) });
  const client = createAnthropicSignalExplainerClient({ apiKey: "hunter2hunter2", fetchImpl });
  await assert.rejects(() => client.explain({ market: "KRW-BTC", signal: signal(), recentPrices: [] }));
});

test("end to end: explainStrategySignal with the real Anthropic client shape (network mocked)", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "단기 이동평균이 장기 이동평균을 상향 돌파했습니다." }] })
  });
  const client = createAnthropicSignalExplainerClient({ apiKey: "hunter2hunter2", fetchImpl });
  const request = { market: "KRW-BTC", signal: signal(), recentPrices: [100, 101, 102] };
  const result = await explainStrategySignal({ request, client, nowMs: 9999 });
  assert.equal(result.status, "OK");
  assert.equal(result.explanation, "단기 이동평균이 장기 이동평균을 상향 돌파했습니다.");
});
