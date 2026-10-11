const test = require("node:test");
const assert = require("node:assert/strict");

const { MobileApprovedSession, SESSION_STORAGE_KEY, MOBILE_SESSION_REQUEST_TIMEOUT_MS } = require("../dist/apps/mobile/src/mobileApprovedSession.js");

class MemorySecureStorage {
  constructor() { this.values = new Map(); }
  async getSecret(key) { return this.values.get(key) ?? null; }
  async setSecret(key, value) { this.values.set(key, value); }
  async deleteSecret(key) { this.values.delete(key); }
}

test("a stalled session request times out instead of holding the restore forever", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const endpoint = "https://paper.example";
  const storage = new MemorySecureStorage();
  storage.values.set(SESSION_STORAGE_KEY, new TextEncoder().encode(JSON.stringify({ endpoint, refreshToken: "stale-refresh-token-0123456789", refreshExpiresAt: Date.now() + 600_000, deviceId: "nusa-device-stall-0001" })));
  let aborted = false;
  const request = (_url, init) => new Promise((_, reject) => { init.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }); });
  const session = new MobileApprovedSession(storage, request);
  const outcome = session.restore(endpoint).then(() => "resolved", (error) => error.message);
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(MOBILE_SESSION_REQUEST_TIMEOUT_MS);
  assert.equal(await outcome, "mobile session request timed out.");
  assert.equal(aborted, true);
  assert.equal(session.shouldRetryRestore(), true, "a timeout is transient, so the bounded retry takes over");
});
