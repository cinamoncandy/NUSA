import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MobileApprovedSession, PAIRING_STORAGE_KEY, SESSION_STORAGE_KEY } from "./mobileApprovedSession";
import type { SecureStoragePort } from "./mobileSecurity";

class MemorySecureStorage implements SecureStoragePort {
  readonly values = new Map<string, Uint8Array>();
  setCount = 0;
  getCount = 0;
  deleteCount = 0;

  async setSecret(key: string, value: Uint8Array): Promise<void> {
    this.setCount += 1;
    this.values.set(key, new Uint8Array(value));
  }

  async getSecret(key: string): Promise<Uint8Array | null> {
    this.getCount += 1;
    const value = this.values.get(key);
    return value === undefined ? null : new Uint8Array(value);
  }

  async deleteSecret(key: string): Promise<void> {
    this.deleteCount += 1;
    this.values.delete(key);
  }
}

describe("mobile approved session persistence boundary", () => {
  it("persists only the rotating refresh session in secure storage", async () => {
    const storage = new MemorySecureStorage();
    const endpoint = "https://paper.example";
    const now = Date.now();
    const request = (async (url: string | URL | Request) => {
      const value = String(url);
      if (value.endsWith("/v1/mobile/bootstrap")) {
        return new Response(JSON.stringify({
          accessToken: "access-token-0123456789",
          accessExpiresAt: now + 60_000,
          refreshToken: "refresh-token-0123456789",
          refreshExpiresAt: now + 600_000,
          scopes: ["dashboard:read", "paper:trade"],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (value.endsWith("/v1/mobile/me")) {
        return new Response(JSON.stringify({ userId: "mobile-user", email: "mobile@example.com", scopes: ["dashboard:read", "paper:trade"] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected request ${value}`);
    }) as typeof fetch;

    const session = new MobileApprovedSession(storage, request);
    assert.equal((await session.connectBootstrap(endpoint, "bootstrap-token-0123456789")).userId, "mobile-user");
    assert.equal(storage.setCount, 1);
    assert.equal(storage.getCount, 0);
    const persisted = storage.values.get(SESSION_STORAGE_KEY);
    assert.ok(persisted);
    assert.doesNotMatch(new TextDecoder().decode(persisted), /access-token/);
    assert.match(new TextDecoder().decode(persisted), /refresh-token/);
  });

  it("restores an approved credential after process restart without user input", async () => {
    const storage = new MemorySecureStorage();
    const endpoint = "https://paper.example";
    const now = Date.now();
    const request = (async (url: string | URL | Request) => {
      const value = String(url);
      if (value.endsWith("/v1/mobile/bootstrap") || value.endsWith("/v1/mobile/session/refresh")) return new Response(JSON.stringify({ accessToken: "restored-access-token-0123456789", accessExpiresAt: now + 60_000, refreshToken: "rotated-refresh-token-0123456789", refreshExpiresAt: now + 600_000, scopes: ["dashboard:read", "paper:trade"] }), { status: 200 });
      if (value.endsWith("/v1/mobile/me")) return new Response(JSON.stringify({ userId: "mobile-user", email: "mobile@example.com", scopes: ["dashboard:read", "paper:trade"] }), { status: 200 });
      throw new Error(`unexpected request ${value}`);
    }) as typeof fetch;
    const first = new MobileApprovedSession(storage, request);
    await first.connectBootstrap(endpoint, "bootstrap-token-0123456789");
    const restarted = new MobileApprovedSession(storage, request);
    assert.equal((await restarted.restore(endpoint))?.userId, "mobile-user");
    assert.equal(restarted.hasMemoryAccess(), true);
    assert.equal(storage.getCount, 1);
  });

  it("rejects malformed persisted session and deletes it without network access", async () => {
    const storage = new MemorySecureStorage();
    storage.values.set(SESSION_STORAGE_KEY, new Uint8Array([1, 2, 3]));
    storage.values.set(PAIRING_STORAGE_KEY, new Uint8Array([4, 5, 6]));
    const session = new MobileApprovedSession(storage, (async () => { throw new Error("network must not be reached"); }) as typeof fetch);

    assert.equal(await session.restore("https://paper.example"), null);
    assert.equal(storage.getCount, 1);
    assert.equal(storage.values.has(SESSION_STORAGE_KEY), false);
    assert.equal(storage.values.has(PAIRING_STORAGE_KEY), false);
    assert.equal(storage.deleteCount, 2);
  });
});
