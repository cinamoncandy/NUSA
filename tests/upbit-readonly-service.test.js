const test = require("node:test");
const assert = require("node:assert/strict");
const { UpbitReadOnlyService } = require("../dist/apps/desktop/src/upbitReadOnlyService.js");

test("read-only service reports not configured without provider access", async () => {
  let loaded = 0;
  const service = new UpbitReadOnlyService({ loadCredentials: async () => { loaded += 1; return null; }, hasCredentials: async () => false, saveCredentials: async () => {}, deleteCredentials: async () => {} });
  const result = await service.testConnection();
  assert.equal(result.code, "NOT_CONFIGURED");
  assert.equal(loaded, 1);
});

test("read-only service sanitizes provider failures", async () => {
  const service = new UpbitReadOnlyService({ loadCredentials: async () => ({ accessKey: "access-key", secretKey: "secret-key" }), hasCredentials: async () => true, saveCredentials: async () => {}, deleteCredentials: async () => {} }, () => { throw new Error("Authorization: Bearer secret-key"); });
  const result = await service.testConnection();
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.message, /secret-key/);
});
