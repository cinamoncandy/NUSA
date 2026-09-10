import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MobileApprovedSession, SESSION_STORAGE_KEY } from "./mobileApprovedSession";
import type { SecureStoragePort } from "./mobileSecurity";

class MemorySecureStorage implements SecureStoragePort {
  readonly values = new Map<string, Uint8Array>();
  deleteCount = 0;

  async setSecret(key: string, value: Uint8Array): Promise<void> {
    this.values.set(key, new Uint8Array(value));
  }

  async getSecret(key: string): Promise<Uint8Array | null> {
    const value = this.values.get(key);
    return value === undefined ? null : new Uint8Array(value);
  }

  async deleteSecret(key: string): Promise<void> {
    this.deleteCount += 1;
    this.values.delete(key);
  }
}

function ascii(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index);
  return bytes;
}

function seedSession(storage: MemorySecureStorage, endpoint = "https://paper.example"): void {
  storage.values.set(SESSION_STORAGE_KEY, ascii(JSON.stringify({
    endpoint,
    refreshToken: "refresh-token-0123456789",
    refreshExpiresAt: Date.now() + 10 * 60_000,
    deviceId: "device-01234567",
  })));
}

const rejectingFetch = (status: number): typeof fetch => (async () => new Response("{}", {
  status,
  headers: { "content-type": "application/json" },
})) as typeof fetch;

const failingFetch = (): typeof fetch => (async () => {
  throw new Error("network unavailable");
}) as typeof fetch;

describe("mobile approved session restore", () => {
  it("retains encrypted refresh state after 429 overload so restore can retry", async () => {
    const storage = new MemorySecureStorage();
    seedSession(storage);
    const session = new MobileApprovedSession(storage, rejectingFetch(429));

    assert.equal(await session.restore("https://paper.example"), null);
    assert.equal(session.shouldRetryRestore(), true);
    assert.equal(storage.deleteCount, 0);
    assert.notEqual(await storage.getSecret(SESSION_STORAGE_KEY), null);
  });

  it("retains encrypted refresh state after a transport failure so restore can retry", async () => {
    const storage = new MemorySecureStorage();
    seedSession(storage);
    const session = new MobileApprovedSession(storage, failingFetch());

    assert.equal(await session.restore("https://paper.example"), null);
    assert.equal(session.shouldRetryRestore(), true);
    assert.equal(storage.deleteCount, 0);
    assert.notEqual(await storage.getSecret(SESSION_STORAGE_KEY), null);
  });

  it("destroys stored refresh state after definitive 401 rejection", async () => {
    const storage = new MemorySecureStorage();
    seedSession(storage);
    const session = new MobileApprovedSession(storage, rejectingFetch(401));

    assert.equal(await session.restore("https://paper.example"), null);
    assert.equal(session.shouldRetryRestore(), false);
    // A definitive authorization rejection destroys both secure-state namespaces:
    // the rotating session and any pending device pairing capability.
    assert.equal(storage.deleteCount, 2);
    assert.equal(await storage.getSecret(SESSION_STORAGE_KEY), null);
  });

  it("destroys stored refresh state after definitive 403 rejection", async () => {
    const storage = new MemorySecureStorage();
    seedSession(storage);
    const session = new MobileApprovedSession(storage, rejectingFetch(403));

    assert.equal(await session.restore("https://paper.example"), null);
    assert.equal(session.shouldRetryRestore(), false);
    // Keep the fail-closed cleanup contract symmetric with 401.
    assert.equal(storage.deleteCount, 2);
    assert.equal(await storage.getSecret(SESSION_STORAGE_KEY), null);
  });
});
