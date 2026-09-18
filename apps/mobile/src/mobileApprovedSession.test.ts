import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LEGACY_SESSION_STORAGE_KEY, MobileApprovedSession, PAIRING_STORAGE_KEY, SESSION_STORAGE_KEY } from "./mobileApprovedSession";
import type { SecureStoragePort } from "./mobileSecurity";
import { MobileSecureStorageAuthenticationRequiredError } from "./androidSecureStorage";

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

describe("mobile approved session restart recovery", () => {
  it("stores only a device-bound rotating refresh capability after a successful bootstrap", async () => {
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
    const stored = new TextDecoder().decode(storage.values.get(SESSION_STORAGE_KEY) ?? new Uint8Array());
    assert.match(stored, /refresh-token-0123456789/);
    assert.doesNotMatch(stored, /access-token-0123456789|bootstrap-token-0123456789|mobile-user|mobile@example\.com/);
  });

  it("restores by rotating the Keystore refresh capability after a process restart", async () => {
    const storage = new MemorySecureStorage();
    const endpoint = "https://paper.example";
    const now = Date.now();
    storage.values.set(SESSION_STORAGE_KEY, new TextEncoder().encode(JSON.stringify({ endpoint, refreshToken: "refresh-token-0123456789", refreshExpiresAt: now + 600_000, deviceId: "device-12345678" })));
    const requests: string[] = [];
    const restarted = new MobileApprovedSession(storage, (async (url: string | URL | Request) => {
      const value = String(url);
      requests.push(value);
      if (value.endsWith("/v1/mobile/session/refresh")) return new Response(JSON.stringify({
        accessToken: "rotated-access-token-0123456789", accessExpiresAt: now + 60_000,
        refreshToken: "rotated-refresh-token-0123456789", refreshExpiresAt: now + 600_000,
        scopes: ["dashboard:read", "paper:trade"], deviceId: "device-12345678"
      }), { status: 200, headers: { "content-type": "application/json" } });
      if (value.endsWith("/v1/mobile/me")) return new Response(JSON.stringify({ userId: "mobile-user", email: "mobile@example.com", scopes: ["dashboard:read", "paper:trade"] }), { status: 200, headers: { "content-type": "application/json" } });
      throw new Error(`unexpected request ${value}`);
    }) as typeof fetch);
    assert.equal((await restarted.restore(endpoint))?.userId, "mobile-user");
    assert.equal(restarted.hasMemoryAccess(), true);
    assert.deepEqual(requests.map((value) => new URL(value).pathname), ["/v1/mobile/session/refresh", "/v1/mobile/me"]);
    const stored = new TextDecoder().decode(storage.values.get(SESSION_STORAGE_KEY) ?? new Uint8Array());
    assert.match(stored, /rotated-refresh-token-0123456789/);
    assert.doesNotMatch(stored, /rotated-access-token-0123456789|mobile-user|mobile@example\.com/);
  });

  it("fails closed and removes a rejected persisted session", async () => {
    const storage = new MemorySecureStorage();
    const endpoint = "https://paper.example";
    storage.values.set(SESSION_STORAGE_KEY, new TextEncoder().encode(JSON.stringify({ endpoint, refreshToken: "refresh-token-0123456789", refreshExpiresAt: Date.now() + 600_000 })));
    const session = new MobileApprovedSession(storage, (async () => new Response("{}", { status: 403, headers: { "content-type": "application/json" } })) as typeof fetch);

    assert.equal(await session.restore(endpoint), null);
    assert.equal(session.shouldRetryRestore(), false);
    assert.equal(storage.values.has(SESSION_STORAGE_KEY), false);
  });

  it("retains the approved refresh record while Android asks the owner to unlock the device", async () => {
    const storage = new MemorySecureStorage();
    storage.values.set(SESSION_STORAGE_KEY, new TextEncoder().encode(JSON.stringify({ endpoint: "https://paper.example", refreshToken: "refresh-token-0123456789", refreshExpiresAt: Date.now() + 600_000 })));
    storage.getSecret = async (key: string): Promise<Uint8Array | null> => {
      if (key === SESSION_STORAGE_KEY) throw new MobileSecureStorageAuthenticationRequiredError();
      return null;
    };
    const session = new MobileApprovedSession(storage, (async () => { throw new Error("network must not be reached"); }) as typeof fetch);
    assert.equal(await session.restore("https://paper.example"), null);
    assert.equal(session.requiresDeviceAuthentication(), true);
    assert.equal(storage.values.has(SESSION_STORAGE_KEY), true);
  });

  it("destroys v1 and pairing legacy material without reading it", async () => {
    const storage = new MemorySecureStorage();
    storage.values.set(LEGACY_SESSION_STORAGE_KEY, new Uint8Array([1, 2, 3]));
    storage.values.set(PAIRING_STORAGE_KEY, new Uint8Array([4, 5, 6]));
    const session = new MobileApprovedSession(storage, (async () => { throw new Error("network must not be reached"); }) as typeof fetch);
    assert.equal(await session.restore("https://paper.example"), null);
    assert.equal(storage.values.has(LEGACY_SESSION_STORAGE_KEY), false);
    assert.equal(storage.values.has(PAIRING_STORAGE_KEY), false);
  });
});
