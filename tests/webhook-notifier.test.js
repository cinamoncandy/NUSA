const test = require("node:test");
const assert = require("node:assert/strict");
const { isValidWebhookUrl, sendWebhookNotification } = require("../dist/apps/server/src/webhookNotifier.js");

test("isValidWebhookUrl accepts http/https, rejects other schemes and unparseable input", () => {
  assert.equal(isValidWebhookUrl("https://example.com/hook"), true);
  assert.equal(isValidWebhookUrl("http://localhost:3000/hook"), true);
  assert.equal(isValidWebhookUrl("ftp://example.com/hook"), false);
  assert.equal(isValidWebhookUrl("javascript:alert(1)"), false);
  assert.equal(isValidWebhookUrl("file:///etc/passwd"), false);
  assert.equal(isValidWebhookUrl("not a url"), false);
  assert.equal(isValidWebhookUrl(""), false);
});

test("sendWebhookNotification POSTs the event as JSON to the given URL", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200 };
  };
  try {
    await sendWebhookNotification("https://example.com/hook", {
      type: "ORDER",
      message: "manual BUY filled",
      timestamp: "2026-01-01T00:00:00.000Z"
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://example.com/hook");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      type: "ORDER",
      message: "manual BUY filled",
      timestamp: "2026-01-01T00:00:00.000Z"
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendWebhookNotification never throws, even when the network call fails outright", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("network down"); };
  try {
    await assert.doesNotReject(sendWebhookNotification("https://example.com/hook", {
      type: "RISK", message: "stop-loss triggered", timestamp: "2026-01-01T00:00:00.000Z"
    }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendWebhookNotification never throws on a non-2xx response either", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 500 });
  try {
    await assert.doesNotReject(sendWebhookNotification("https://example.com/hook", {
      type: "RISK", message: "stop-loss triggered", timestamp: "2026-01-01T00:00:00.000Z"
    }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
