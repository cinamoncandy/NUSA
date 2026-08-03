const test = require("node:test");
const assert = require("node:assert/strict");
const { ApiClient, ApiClientError, createMockTransport } = require("../dist/apps/mobile/src/apiClient.js");

test("API client builds typed GET requests and returns response data", async () => {
  const calls = [];
  const client = new ApiClient({ baseUrl: "https://paper.test", transport: { async request(input) { calls.push(input); return { status: 200, data: { mode: "PAPER" } }; } } });
  assert.deepEqual(await client.get("/api/status"), { status: 200, data: { mode: "PAPER" } });
  assert.equal(calls[0].url, "https://paper.test/api/status");
});

test("API client retries retriable HTTP failures with a bounded policy", async () => {
  const client = new ApiClient({ maxRetries: 2, retryDelayMs: 1, transport: createMockTransport([{ status: 503, data: {} }, { status: 503, data: {} }, { status: 200, data: { ok: true } }]) });
  assert.deepEqual((await client.get("/health")).data, { ok: true });
});

test("API client exposes typed non-retriable errors", async () => {
  const client = new ApiClient({ maxRetries: 2, retryDelayMs: 1, transport: createMockTransport([{ status: 400, data: { error: "bad request" } }]) });
  await assert.rejects(() => client.get("/bad"), (error) => error instanceof ApiClientError && error.code === "HTTP_ERROR" && error.status === 400 && !error.retriable);
});
