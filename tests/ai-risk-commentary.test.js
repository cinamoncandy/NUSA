const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildRiskCommentaryPrompt,
  explainRiskCommentary,
  createAnthropicRiskCommentaryClient
} = require("../dist/apps/desktop/src/ai/aiRiskCommentary.js");

function request(overrides = {}) {
  return {
    market: "KRW-BTC",
    dashboardStatus: "HEALTHY",
    risk: {
      status: "HEALTHY",
      generatedAt: 1000,
      reasons: [],
      killSwitchActive: false,
      dailyDrawdownRatio: 0.02,
      liquidationBufferRatio: 0.8,
      portfolioHeatRatio: 0.15
    },
    warnings: [],
    ...overrides
  };
}

test("buildRiskCommentaryPrompt includes the risk metrics and kill switch state", () => {
  const prompt = buildRiskCommentaryPrompt(request());
  assert.ok(prompt.includes("Daily drawdown ratio: 0.02"));
  assert.ok(prompt.includes("Portfolio heat ratio: 0.15"));
  assert.ok(prompt.includes("Liquidation buffer ratio: 0.8"));
  assert.ok(prompt.includes("Kill switch active: false"));
  assert.ok(prompt.includes("PAPER-TRADING"));
});

test("buildRiskCommentaryPrompt reports (none) when there are no reasons or warnings", () => {
  const prompt = buildRiskCommentaryPrompt(request());
  assert.ok(prompt.includes("Risk section reasons: (none)"));
  assert.ok(prompt.includes("Dashboard warnings: (none)"));
});

test("buildRiskCommentaryPrompt includes reasons and warnings when present", () => {
  const prompt = buildRiskCommentaryPrompt(request({
    risk: { ...request().risk, reasons: ["drawdown elevated"] },
    warnings: ["heat approaching limit"]
  }));
  assert.ok(prompt.includes("Risk section reasons: drawdown elevated"));
  assert.ok(prompt.includes("Dashboard warnings: heat approaching limit"));
});

test("explainRiskCommentary reports NOT_CONFIGURED when no client is wired", async () => {
  const result = await explainRiskCommentary({ request: request(), client: undefined, nowMs: 5000 });
  assert.equal(result.status, "NOT_CONFIGURED");
});

test("explainRiskCommentary reports NO_DATA when there is no request", async () => {
  const client = { explainRisk: async () => "should not be called" };
  const result = await explainRiskCommentary({ request: undefined, client, nowMs: 5000 });
  assert.equal(result.status, "NO_DATA");
});

test("explainRiskCommentary returns OK with the client's commentary", async () => {
  const client = { explainRisk: async () => "리스크 코멘터리입니다" };
  const result = await explainRiskCommentary({ request: request(), client, nowMs: 5000 });
  assert.equal(result.status, "OK");
  assert.equal(result.commentary, "리스크 코멘터리입니다");
});

test("explainRiskCommentary reports UNAVAILABLE instead of throwing when the client fails", async () => {
  const client = { explainRisk: async () => { throw new Error("network down"); } };
  const result = await explainRiskCommentary({ request: request(), client, nowMs: 5000 });
  assert.equal(result.status, "UNAVAILABLE");
});

test("createAnthropicRiskCommentaryClient sends the prompt and returns the text block", async () => {
  let capturedInit;
  const fetchImpl = async (_url, init) => {
    capturedInit = init;
    return { ok: true, json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "리스크 설명입니다" }] }) };
  };
  const client = createAnthropicRiskCommentaryClient({ apiKey: "hunter2hunter2", fetchImpl });
  const commentary = await client.explainRisk(request());
  assert.equal(commentary, "리스크 설명입니다");
  const body = JSON.parse(capturedInit.body);
  assert.equal(body.model, "claude-opus-5");
  assert.ok(body.messages[0].content.includes("Daily drawdown ratio: 0.02"));
});

test("createAnthropicRiskCommentaryClient throws on a non-ok HTTP response", async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const client = createAnthropicRiskCommentaryClient({ apiKey: "hunter2hunter2", fetchImpl });
  await assert.rejects(() => client.explainRisk(request()));
});

test("createAnthropicRiskCommentaryClient throws when the API declines the request", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ stop_reason: "refusal", content: [] }) });
  const client = createAnthropicRiskCommentaryClient({ apiKey: "hunter2hunter2", fetchImpl });
  await assert.rejects(() => client.explainRisk(request()));
});
