const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSignalExplanationPrompt,
  buildSignalFollowUpPrompt,
  explainStrategySignal,
  answerSignalFollowUp,
  createAnthropicSignalExplainerClient
} = require("../dist/apps/desktop/src/ai/aiSignalExplainer.js");

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

test("buildSignalExplanationPrompt includes recent signal transitions when present", () => {
  const history = [signal({ type: "HOLD", reason: "no-cross", timestamp: 500 }), signal({ type: "BUY", timestamp: 1000 })];
  const withHistory = buildSignalExplanationPrompt({ market: "KRW-BTC", signal: signal(), recentPrices: [], signalHistory: history });
  assert.ok(withHistory.includes("HOLD (no-cross)"));
  assert.ok(withHistory.includes("BUY (short-SMA crossed above long-SMA)"));
  const withoutHistory = buildSignalExplanationPrompt({ market: "KRW-BTC", signal: signal(), recentPrices: [] });
  assert.ok(withoutHistory.includes("no prior transitions recorded"));
});

test("buildSignalFollowUpPrompt includes the prior explanation and the question", () => {
  const prompt = buildSignalFollowUpPrompt({
    request: { market: "KRW-BTC", signal: signal(), recentPrices: [100] },
    priorExplanation: "단기 이동평균이 장기 이동평균을 상향 돌파했습니다.",
    question: "신뢰도가 왜 낮아요?"
  });
  assert.ok(prompt.includes("단기 이동평균이 장기 이동평균을 상향 돌파했습니다."));
  assert.ok(prompt.includes("신뢰도가 왜 낮아요?"));
  assert.ok(prompt.includes("PAPER-TRADING"));
});

test("answerSignalFollowUp reports NOT_CONFIGURED when no client is wired", async () => {
  const result = await answerSignalFollowUp({ request: undefined, priorExplanation: undefined, question: "왜?", client: undefined, nowMs: 5000 });
  assert.equal(result.status, "NOT_CONFIGURED");
});

test("answerSignalFollowUp reports NO_SIGNAL when there is no prior explanation to follow up on", async () => {
  const client = { explain: async () => "unused", answerFollowUp: async () => "should not be called" };
  const result = await answerSignalFollowUp({ request: undefined, priorExplanation: undefined, question: "왜?", client, nowMs: 5000 });
  assert.equal(result.status, "NO_SIGNAL");
});

test("answerSignalFollowUp reports INVALID_QUESTION for empty or overlong questions", async () => {
  const client = { explain: async () => "unused", answerFollowUp: async () => "should not be called" };
  const request = { market: "KRW-BTC", signal: signal(), recentPrices: [] };
  const empty = await answerSignalFollowUp({ request, priorExplanation: "설명", question: "   ", client, nowMs: 5000 });
  assert.equal(empty.status, "INVALID_QUESTION");
  const overlong = await answerSignalFollowUp({ request, priorExplanation: "설명", question: "a".repeat(301), client, nowMs: 5000 });
  assert.equal(overlong.status, "INVALID_QUESTION");
});

test("answerSignalFollowUp returns OK with the client's answer", async () => {
  const client = { explain: async () => "unused", answerFollowUp: async ({ question }) => `답변: ${question}` };
  const request = { market: "KRW-BTC", signal: signal(), recentPrices: [] };
  const result = await answerSignalFollowUp({ request, priorExplanation: "설명", question: "왜?", client, nowMs: 5000 });
  assert.equal(result.status, "OK");
  assert.equal(result.answer, "답변: 왜?");
});

test("answerSignalFollowUp reports UNAVAILABLE instead of throwing when the client fails", async () => {
  const client = { explain: async () => "unused", answerFollowUp: async () => { throw new Error("network down"); } };
  const request = { market: "KRW-BTC", signal: signal(), recentPrices: [] };
  const result = await answerSignalFollowUp({ request, priorExplanation: "설명", question: "왜?", client, nowMs: 5000 });
  assert.equal(result.status, "UNAVAILABLE");
});

test("createAnthropicSignalExplainerClient.answerFollowUp sends the follow-up prompt", async () => {
  let capturedInit;
  const fetchImpl = async (_url, init) => {
    capturedInit = init;
    return { ok: true, json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "답변입니다" }] }) };
  };
  const client = createAnthropicSignalExplainerClient({ apiKey: "hunter2hunter2", fetchImpl });
  const request = { market: "KRW-BTC", signal: signal(), recentPrices: [100] };
  const answer = await client.answerFollowUp({ request, priorExplanation: "이전 설명", question: "왜?" });
  assert.equal(answer, "답변입니다");
  const body = JSON.parse(capturedInit.body);
  assert.ok(body.messages[0].content.includes("이전 설명"));
  assert.ok(body.messages[0].content.includes("왜?"));
});
