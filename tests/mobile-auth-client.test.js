const test = require("node:test");
const assert = require("node:assert/strict");
const { MobileClientAuthError, MobileSessionProvider } = require("../dist/apps/mobile/src/mobileAuthClient.js");

class MemorySecureStorage {
  constructor() { this.values = new Map(); }
  async setSecret(key, value) { this.values.set(key, new Uint8Array(value)); }
  async getSecret(key) { return this.values.get(key) ?? null; }
  async deleteSecret(key) { this.values.delete(key); }
}

const session = (n) => ({ tokenType: "Bearer", accessToken: `access-${n}`, refreshToken: `refresh-${n}`, sessionId: `session-${n}`, expiresAtMs: n === 1 ? 100 : 1_000, refreshExpiresAtMs: 10_000, audience: "nusa-mobile", scopes: ["paper:read", "paper:simulate", "portfolio:read", "history:read", "ai:read", "broker:read"] });

test("mobile provider bootstraps and persists only through secure storage", async () => {
  const storage = new MemorySecureStorage();
  const calls = [];
  const transport = { async request(path, input) { calls.push({ path, input }); return { status: 200, body: session(1) }; } };
  const provider = new MobileSessionProvider(storage, transport, "device-1", () => 50);
  const result = await provider.bootstrap("one-time-proof");
  assert.equal(result.accessToken, "access-1");
  assert.equal(await provider.accessToken(), "access-1");
  assert.equal(calls[0].path, "/api/mobile/session/bootstrap");
  assert.equal(calls[0].input.body.deviceId, "device-1");
  assert.equal(calls[0].input.body.proof, "one-time-proof");
  assert.equal(storage.values.size, 1);
});

test("expired access refreshes once, and refresh failure clears the secure session", async () => {
  const storage = new MemorySecureStorage();
  let now = 50;
  let refreshed = false;
  const transport = { async request(path) { if (path === "/api/mobile/session/refresh") { refreshed = true; return { status: 200, body: session(2) }; } return { status: 200, body: session(1) }; } };
  const provider = new MobileSessionProvider(storage, transport, "device-1", () => now);
  await provider.bootstrap("proof");
  now = 101;
  assert.equal(await provider.accessToken(), "access-2");
  assert.equal(refreshed, true);

  const failing = new MobileSessionProvider(storage, { async request() { return { status: 401, body: { error: "SESSION_REVOKED" } }; } }, "device-1", () => 1_001);
  await assert.rejects(() => failing.accessToken(), (error) => error instanceof MobileClientAuthError && error.code === "SESSION_REVOKED");
  assert.equal(await storage.getSecret("nusa:mobile-session:v1"), null);
});

test("logout/revoke removes the persisted session and never sends a dashboard credential", async () => {
  const storage = new MemorySecureStorage();
  const requests = [];
  const provider = new MobileSessionProvider(storage, { async request(path, input) { requests.push({ path, input }); return { status: 200, body: session(1) }; } }, "device-1", () => 1);
  await provider.bootstrap("proof");
  await provider.revoke();
  assert.equal(await provider.load(), null);
  assert.equal(requests[1].path, "/api/mobile/session/revoke");
  assert.equal(requests[1].input.accessToken, "access-1");
  assert.equal("dashboardToken" in requests[1].input, false);
});
