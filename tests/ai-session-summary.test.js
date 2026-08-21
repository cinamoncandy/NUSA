const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSessionSummaryPrompt,
  summarizeSession,
  createAnthropicSessionSummaryClient
} = require("../dist/apps/desktop/src/ai/aiSessionSummary.js");

function request(overrides = {}) {
  return {
    market: "KRW-BTC",
    account: { cash: 900000, equity: 1000000, unrealizedPnl: 5000, realizedPnl: -2000 },
    latestSignal: { type: "BUY", reason: "short-SMA crossed above long-SMA" },
    signalHistory: [],
    challengerStats: { totalObservations: 0, agreementCount: 0, agreementRate: null },
    ...overrides
  };
}

test("buildSessionSummaryPrompt includes account figures and the latest signal", () => {
  const prompt = buildSessionSummaryPrompt(request());
  assert.ok(prompt.includes("Equity: 1000000"));
  assert.ok(prompt.includes("Unrealized PnL: 5000"));
  assert.ok(prompt.includes("Realized PnL: -2000"));
  assert.ok(prompt.includes("BUY (short-SMA crossed above long-SMA)"));
  assert.ok(prompt.includes("PAPER-TRADING"));
});

test("buildSessionSummaryPrompt reports no signal when none has fired yet", () => {
  const prompt = buildSessionSummaryPrompt(request({ latestSignal: undefined }));
  assert.ok(prompt.includes("Latest signal: none yet"));
});

test("buildSessionSummaryPrompt includes the challenger agreement rate when observations exist", () => {
  const prompt = buildSessionSummaryPrompt(request({ challengerStats: { totalObservations: 4, agreementCount: 3, agreementRate: 0.75 } }));
  assert.ok(prompt.includes("agreed with the strategy in 3 of 4 observations (75%)"));
});

test("buildSessionSummaryPrompt reports no observations when the challenger has none yet", () => {
  const prompt = buildSessionSummaryPrompt(request());
  assert.ok(prompt.includes("AI challenger comparison: no observations yet"));
});

test("summarizeSession reports NOT_CONFIGURED when no client is wired", async () => {
  const result = await summarizeSession({ request: request(), client: undefined, nowMs: 5000 });
  assert.equal(result.status, "NOT_CONFIGURED");
});

test("summarizeSession reports NO_DATA when there is no request", async () => {
  const client = { summarize: async () => "should not be called" };
  const result = await summarizeSession({ request: undefined, client, nowMs: 5000 });
  assert.equal(result.status, "NO_DATA");
});

test("summarizeSession returns OK with the client's summary", async () => {
  const client = { summarize: async () => "요약입니다" };
  const result = await summarizeSession({ request: request(), client, nowMs: 5000 });
  assert.equal(result.status, "OK");
  assert.equal(result.summary, "요약입니다");
});

test("summarizeSession reports UNAVAILABLE instead of throwing when the client fails", async () => {
  const client = { summarize: async () => { throw new Error("network down"); } };
  const result = await summarizeSession({ request: request(), client, nowMs: 5000 });
  assert.equal(result.status, "UNAVAILABLE");
});

test("createAnthropicSessionSummaryClient sends the prompt and returns the text block", async () => {
  let capturedInit;
  const fetchImpl = async (_url, init) => {
    capturedInit = init;
    return { ok: true, json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "세션 요약입니다" }] }) };
  };
  const client = createAnthropicSessionSummaryClient({ apiKey: "hunter2hunter2", fetchImpl });
  const summary = await client.summarize(request());
  assert.equal(summary, "세션 요약입니다");
  const body = JSON.parse(capturedInit.body);
  assert.equal(body.model, "claude-opus-5");
  assert.ok(body.messages[0].content.includes("Equity: 1000000"));
});

test("createAnthropicSessionSummaryClient throws on a non-ok HTTP response", async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const client = createAnthropicSessionSummaryClient({ apiKey: "hunter2hunter2", fetchImpl });
  await assert.rejects(() => client.summarize(request()));
});

test("createAnthropicSessionSummaryClient throws when the API declines the request", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ stop_reason: "refusal", content: [] }) });
  const client = createAnthropicSessionSummaryClient({ apiKey: "hunter2hunter2", fetchImpl });
  await assert.rejects(() => client.summarize(request()));
});
