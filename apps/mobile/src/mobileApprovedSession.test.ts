import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MobileApprovedSession, MobileSessionRequestError, PAIRING_STORAGE_KEY, SESSION_STORAGE_KEY } from "./mobileApprovedSession";
import type { SecureStoragePort } from "./mobileSecurity";
import type { OwnerDeviceCredentialNative } from "./ownerDeviceCredential";

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

  it("coalesces concurrent silent restores and preserves DeviceKey on 429", async () => {
    const storage = new MemorySecureStorage();
    const endpoint = "https://paper.example";
    let challenges = 0;
    let deleted = 0;
    const request = (async (url: string | URL | Request) => {
      const value = String(url);
      if (value.endsWith("/v1/mobile/owner-device/authentication/challenge")) {
        challenges += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return new Response(JSON.stringify({ error: "RATE_LIMITED" }), { status: 429, headers: { "content-type": "application/json", "retry-after": "2" } });
      }
      throw new Error("unexpected request " + value);
    }) as typeof fetch;
    const native = {
      getSilentDeviceStatus: async () => ({ available: true, canCreate: true, hardwareBacked: true, status: "SILENT_DEVICE_KEY_PRESENT", credentialId: "silent-credential-0123456789" }),
      signSilentChallenge: async () => "MEUCIQDummysignature0123456789ABCD==",
      deleteSilentDeviceCredential: async () => { deleted += 1; },
    } as unknown as OwnerDeviceCredentialNative;
    const session = new MobileApprovedSession(storage, request);
    const results = await Promise.allSettled([
      session.restoreWithSilentDevice(endpoint, "nusa-device-silent-0001", native),
      session.restoreWithSilentDevice(endpoint, "nusa-device-silent-0001", native),
    ]);
    assert.equal(results.every((result) => result.status === "rejected"), true);
    assert.equal(challenges, 1);
    assert.equal(deleted, 0);
    assert.equal(session.shouldRetryRestore(), true);
    const reason = results[0].status === "rejected" ? results[0].reason : null;
    assert.equal(reason instanceof MobileSessionRequestError, true);
    assert.equal((reason as MobileSessionRequestError).status, 429);
    assert.equal((reason as MobileSessionRequestError).retryAfterMs, 2000);
  });

  it("marks a transient native silent-status failure retryable instead of leaving foreground recovery unarmed", async () => {
    // Reproduces a real Galaxy device report: PAPER was connected, the device backgrounded for a
    // while, and on foreground the app was stuck on "PAPER connection required" until the owner
    // opened Settings and reconnected by hand. getSilentDeviceStatus() is a native bridge call and
    // can throw transiently right after Doze/background (Keystore or biometric provider briefly
    // unavailable) -- that is not proof the device was unregistered, and unlike a definitive
    // rejection further down this path, this throw previously escaped unclassified, leaving
    // shouldRetryRestore() false and the foreground retry timer never re-armed.
    const storage = new MemorySecureStorage();
    const endpoint = "https://paper.example";
    const request = (async () => { throw new Error("must not reach the network for a native-status failure"); }) as unknown as typeof fetch;
    const native = {
      getSilentDeviceStatus: async () => { throw new Error("keystore temporarily unavailable"); },
      signSilentChallenge: async () => { throw new Error("must not be called"); },
      deleteSilentDeviceCredential: async () => { throw new Error("must not be called"); },
    } as unknown as OwnerDeviceCredentialNative;
    const session = new MobileApprovedSession(storage, request);
    await assert.rejects(
      () => session.restoreWithSilentDevice(endpoint, "nusa-device-silent-0002", native),
      /keystore temporarily unavailable/,
    );
    assert.equal(session.shouldRetryRestore(), true);
  });

  it("marks retryable when a falsely-negative silent status and an empty bearer session both come up empty", async () => {
    // The native silent-status check resolves available:false on an internal Keystore read
    // exception too -- it never rejects for that (see NusaOwnerDeviceCredentialModule.hasSilentKey).
    // So a transient hardware hiccup and a genuinely absent silent key are indistinguishable here,
    // and this branch falls back to the bearer-refresh restore() path. restore() unconditionally
    // resets restoreRetryable via clearMemory() before it runs, so when nothing is persisted either
    // (also not a definitive rejection), the pre-fix code left restoreRetryable false and the
    // foreground retry timer unarmed -- indistinguishable, from the owner's side, from a real
    // DEVICE_UNREGISTERED.
    const storage = new MemorySecureStorage(); // nothing persisted: no bearer session to fall back to
    const endpoint = "https://paper.example";
    const request = (async () => { throw new Error("must not reach the network with no persisted session and no silent key"); }) as unknown as typeof fetch;
    const native = {
      getSilentDeviceStatus: async () => ({ available: false, canCreate: false, hardwareBacked: false, status: "SILENT_DEVICE_KEY_ABSENT", credentialId: null }),
      signSilentChallenge: async () => { throw new Error("must not be called"); },
      deleteSilentDeviceCredential: async () => { throw new Error("must not be called"); },
    } as unknown as OwnerDeviceCredentialNative;
    const session = new MobileApprovedSession(storage, request);
    await assert.rejects(
      () => session.restoreWithSilentDevice(endpoint, "nusa-device-silent-0003", native),
      /registered silent DeviceKey is unavailable/,
    );
    assert.equal(session.shouldRetryRestore(), true);
  });

  it("a silent connect started during a bearer restore keeps its tokens when the bearer path fails late", async () => {
    // Galaxy report: the PAPER connect button had to be pressed several times. Saving Settings
    // starts a bearer restore; the connect button starts a silent DeviceKey restore. The bearer
    // path's late 401 ran clearLocal() after the silent path accepted fresh tokens and wiped them.
    const storage = new MemorySecureStorage();
    const endpoint = "https://paper.example";
    const now = Date.now();
    storage.values.set(SESSION_STORAGE_KEY, new TextEncoder().encode(JSON.stringify({ endpoint, refreshToken: "stale-refresh-token-0123456789", refreshExpiresAt: now + 600_000, deviceId: "nusa-device-race-0001" })));
    const request = (async (url: string | URL | Request) => {
      const value = String(url);
      if (value.endsWith("/v1/mobile/session/refresh")) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new Response(JSON.stringify({ error: "SESSION_REVOKED" }), { status: 401, headers: { "content-type": "application/json" } });
      }
      if (value.endsWith("/v1/mobile/owner-device/authentication/challenge")) return new Response(JSON.stringify({ challengeId: "challenge-id-0123456789", challenge: "Y2Fub25pY2FsLWNoYWxsZW5nZQ==", purpose: "AUTHENTICATION", expiresAt: now + 60_000 }), { status: 201 });
      if (value.endsWith("/v1/mobile/owner-device/authentication/complete")) return new Response(JSON.stringify({ accessToken: "silent-access-token-0123456789", accessExpiresAt: now + 60_000, refreshToken: "silent-refresh-token-0123456789", refreshExpiresAt: now + 600_000, scopes: ["dashboard:read", "paper:trade"], deviceId: "nusa-device-race-0001" }), { status: 200 });
      if (value.endsWith("/v1/mobile/me")) return new Response(JSON.stringify({ userId: "owner", email: "owner@example.com", scopes: ["dashboard:read", "paper:trade"] }), { status: 200 });
      throw new Error("unexpected request " + value);
    }) as typeof fetch;
    const native = {
      getSilentDeviceStatus: async () => ({ available: true, canCreate: true, hardwareBacked: true, status: "SILENT_DEVICE_KEY_PRESENT", credentialId: "silent-credential-0123456789" }),
      signSilentChallenge: async () => "MEUCIQDummysignature0123456789ABCD==",
      deleteSilentDeviceCredential: async () => { throw new Error("must not delete the silent key"); },
    } as unknown as OwnerDeviceCredentialNative;
    const session = new MobileApprovedSession(storage, request);
    const bearer = session.restore(endpoint);
    const identity = await session.restoreWithSilentDevice(endpoint, "nusa-device-race-0001", native);
    await bearer.catch(() => null);
    assert.equal(identity?.userId, "owner");
    assert.equal(session.hasMemoryAccess(), true, "the late bearer failure must not wipe the silent session");
    assert.equal(await session.credentialProvider(), "silent-access-token-0123456789");
  });

  it("a bearer restore requested while a silent restore is running joins it instead of racing it", async () => {
    const storage = new MemorySecureStorage();
    const endpoint = "https://paper.example";
    const now = Date.now();
    let refreshCalls = 0;
    const request = (async (url: string | URL | Request) => {
      const value = String(url);
      if (value.endsWith("/v1/mobile/session/refresh")) { refreshCalls += 1; throw new Error("must not refresh while silent restore runs"); }
      if (value.endsWith("/v1/mobile/owner-device/authentication/challenge")) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return new Response(JSON.stringify({ challengeId: "challenge-id-0123456789", challenge: "Y2Fub25pY2FsLWNoYWxsZW5nZQ==", purpose: "AUTHENTICATION", expiresAt: now + 60_000 }), { status: 201 });
      }
      if (value.endsWith("/v1/mobile/owner-device/authentication/complete")) return new Response(JSON.stringify({ accessToken: "silent-access-token-0123456789", accessExpiresAt: now + 60_000, refreshToken: "silent-refresh-token-0123456789", refreshExpiresAt: now + 600_000, scopes: ["dashboard:read"], deviceId: "nusa-device-race-0002" }), { status: 200 });
      if (value.endsWith("/v1/mobile/me")) return new Response(JSON.stringify({ userId: "owner", email: "owner@example.com", scopes: ["dashboard:read"] }), { status: 200 });
      throw new Error("unexpected request " + value);
    }) as typeof fetch;
    const native = {
      getSilentDeviceStatus: async () => ({ available: true, canCreate: true, hardwareBacked: true, status: "SILENT_DEVICE_KEY_PRESENT", credentialId: "silent-credential-0123456789" }),
      signSilentChallenge: async () => "MEUCIQDummysignature0123456789ABCD==",
    } as unknown as OwnerDeviceCredentialNative;
    const session = new MobileApprovedSession(storage, request);
    const silent = session.restoreWithSilentDevice(endpoint, "nusa-device-race-0002", native);
    const joined = await session.restore(endpoint);
    await silent;
    assert.equal(joined?.userId, "owner");
    assert.equal(refreshCalls, 0);
    assert.equal(session.hasMemoryAccess(), true);
  });

  it("coalesces concurrent same-endpoint bearer restores into one refresh", async () => {
    const storage = new MemorySecureStorage();
    const endpoint = "https://paper.example";
    const now = Date.now();
    storage.values.set(SESSION_STORAGE_KEY, new TextEncoder().encode(JSON.stringify({ endpoint, refreshToken: "refresh-token-coalesce-0123456789", refreshExpiresAt: now + 600_000 })));
    let refreshCalls = 0;
    const request = (async (url: string | URL | Request) => {
      const value = String(url);
      if (value.endsWith("/v1/mobile/session/refresh")) { refreshCalls += 1; await new Promise((resolve) => setTimeout(resolve, 10)); return new Response(JSON.stringify({ accessToken: "coalesced-access-token-0123456789", accessExpiresAt: now + 60_000, refreshToken: "coalesced-refresh-token-0123456789", refreshExpiresAt: now + 600_000, scopes: ["dashboard:read"] }), { status: 200 }); }
      if (value.endsWith("/v1/mobile/me")) return new Response(JSON.stringify({ userId: "owner", email: "owner@example.com", scopes: ["dashboard:read"] }), { status: 200 });
      throw new Error("unexpected request " + value);
    }) as typeof fetch;
    const session = new MobileApprovedSession(storage, request);
    const getsBefore = storage.getCount;
    const [first, second] = await Promise.all([session.restore(endpoint), session.restore(endpoint)]);
    assert.equal(refreshCalls, 1);
    assert.equal(storage.getCount - getsBefore, 1);
    assert.equal(first?.userId, "owner");
    assert.deepEqual(second, first);
  });

  it("does not join an in-flight restore for a different endpoint", async () => {
    const storage = new MemorySecureStorage();
    const now = Date.now();
    storage.values.set(SESSION_STORAGE_KEY, new TextEncoder().encode(JSON.stringify({ endpoint: "https://paper-a.example", refreshToken: "refresh-token-endpoint-a-0123456789", refreshExpiresAt: now + 600_000 })));
    const request = (async (url: string | URL | Request) => {
      const value = String(url);
      if (value.startsWith("https://paper-a.example/v1/mobile/session/refresh")) { await new Promise((resolve) => setTimeout(resolve, 10)); return new Response(JSON.stringify({ accessToken: "endpoint-a-access-token-0123456789", accessExpiresAt: now + 60_000, refreshToken: "endpoint-a-refresh-token-0123456789", refreshExpiresAt: now + 600_000, scopes: ["dashboard:read"] }), { status: 200 }); }
      if (value.startsWith("https://paper-a.example/v1/mobile/me")) return new Response(JSON.stringify({ userId: "owner-a", email: "a@example.com", scopes: ["dashboard:read"] }), { status: 200 });
      throw new Error("unexpected request " + value);
    }) as typeof fetch;
    const session = new MobileApprovedSession(storage, request);
    const restoreA = session.restore("https://paper-a.example");
    const restoreB = await session.restore("https://paper-b.example");
    assert.equal(restoreB, null, "endpoint B must never receive endpoint A's identity");
    await restoreA.catch(() => null);
  });

  it("a hung bearer restore neither blocks nor later overwrites a silent connect", async () => {
    const storage = new MemorySecureStorage();
    const endpoint = "https://paper.example";
    const now = Date.now();
    storage.values.set(SESSION_STORAGE_KEY, new TextEncoder().encode(JSON.stringify({ endpoint, refreshToken: "hung-refresh-token-0123456789", refreshExpiresAt: now + 600_000, deviceId: "nusa-device-race-0003" })));
    let releaseRefresh: (() => void) | undefined;
    const request = (async (url: string | URL | Request) => {
      const value = String(url);
      if (value.endsWith("/v1/mobile/session/refresh")) {
        await new Promise<void>((resolve) => { releaseRefresh = resolve; });
        return new Response(JSON.stringify({ accessToken: "stale-bearer-access-token-0123456789", accessExpiresAt: now + 60_000, refreshToken: "stale-bearer-refresh-token-0123456789", refreshExpiresAt: now + 600_000, scopes: ["dashboard:read"] }), { status: 200 });
      }
      if (value.endsWith("/v1/mobile/owner-device/authentication/challenge")) return new Response(JSON.stringify({ challengeId: "challenge-id-0123456789", challenge: "Y2Fub25pY2FsLWNoYWxsZW5nZQ==", purpose: "AUTHENTICATION", expiresAt: now + 60_000 }), { status: 201 });
      if (value.endsWith("/v1/mobile/owner-device/authentication/complete")) return new Response(JSON.stringify({ accessToken: "silent-access-token-0123456789", accessExpiresAt: now + 60_000, refreshToken: "silent-refresh-token-0123456789", refreshExpiresAt: now + 600_000, scopes: ["dashboard:read"], deviceId: "nusa-device-race-0003" }), { status: 200 });
      if (value.endsWith("/v1/mobile/me")) return new Response(JSON.stringify({ userId: "owner", email: "owner@example.com", scopes: ["dashboard:read"] }), { status: 200 });
      throw new Error("unexpected request " + value);
    }) as typeof fetch;
    const native = {
      getSilentDeviceStatus: async () => ({ available: true, canCreate: true, hardwareBacked: true, status: "SILENT_DEVICE_KEY_PRESENT", credentialId: "silent-credential-0123456789" }),
      signSilentChallenge: async () => "MEUCIQDummysignature0123456789ABCD==",
    } as unknown as OwnerDeviceCredentialNative;
    const session = new MobileApprovedSession(storage, request);
    const bearer = session.restore(endpoint);
    const identity = await session.restoreWithSilentDevice(endpoint, "nusa-device-race-0003", native);
    assert.equal(identity?.userId, "owner");
    releaseRefresh?.();
    assert.equal(await bearer, null, "a superseded bearer restore reports no identity");
    assert.equal(await session.credentialProvider(), "silent-access-token-0123456789");
  });

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

  it("uses silent DeviceKey proof instead of a persisted bearer refresh after restart", async () => {
    const storage = new MemorySecureStorage();
    const endpoint = "https://paper.example";
    const now = Date.now();
    storage.values.set(SESSION_STORAGE_KEY, new TextEncoder().encode(JSON.stringify({ endpoint, refreshToken: "expired-refresh-token-0123456789", refreshExpiresAt: now + 600_000, deviceId: "nusa-device-silent-0001" })));
    const calls: string[] = [];
    const request = (async (url: string | URL | Request) => {
      const value = String(url); calls.push(value);
      if (value.endsWith("/v1/mobile/session/refresh")) throw new Error("silent DeviceKey restart must not send a bearer refresh");
      if (value.endsWith("/v1/mobile/owner-device/authentication/challenge")) return new Response(JSON.stringify({ challengeId: "challenge-id-0123456789", challenge: "Y2Fub25pY2FsLWNoYWxsZW5nZQ==", purpose: "AUTHENTICATION", expiresAt: now + 60_000 }), { status: 201 });
      if (value.endsWith("/v1/mobile/owner-device/authentication/complete")) return new Response(JSON.stringify({ accessToken: "silent-access-token-0123456789", accessExpiresAt: now + 60_000, refreshToken: "silent-refresh-token-0123456789", refreshExpiresAt: now + 600_000, scopes: ["dashboard:read", "paper:trade"], deviceId: "nusa-device-silent-0001" }), { status: 200 });
      if (value.endsWith("/v1/mobile/me")) return new Response(JSON.stringify({ userId: "owner", email: "owner@example.com", scopes: ["dashboard:read", "paper:trade"] }), { status: 200 });
      throw new Error("unexpected request " + value);
    }) as typeof fetch;
    let signed = 0;
    const native = {
      getSilentDeviceStatus: async () => ({ available: true, canCreate: true, hardwareBacked: true, status: "SILENT_DEVICE_KEY_PRESENT", credentialId: "silent-credential-0123456789" }),
      signSilentChallenge: async () => { signed += 1; return "MEUCIQDummysignature0123456789ABCD=="; },
    } as unknown as OwnerDeviceCredentialNative;
    const session = new MobileApprovedSession(storage, request);
    const identity = await session.restoreWithSilentDevice(endpoint, "nusa-device-silent-0001", native);
    assert.equal(identity?.userId, "owner");
    assert.equal(signed, 1);
    assert.equal(calls.some((value) => value.endsWith("/v1/mobile/owner-device/authentication/challenge")), true);
    assert.equal(calls.some((value) => value.endsWith("/v1/mobile/session/refresh")), false);
  });

  it("deletes a stale silent DeviceKey after definitive server rejection so enrollment can restart", async () => {
    const storage = new MemorySecureStorage();
    const endpoint = "https://paper.example";
    const now = Date.now();
    storage.values.set(SESSION_STORAGE_KEY, new TextEncoder().encode(JSON.stringify({ endpoint, refreshToken: "stale-refresh-token-0123456789", refreshExpiresAt: now + 600_000, deviceId: "nusa-device-stale-0001" })));
    const request = (async (url: string | URL | Request) => {
      const value = String(url);
      if (value.endsWith("/v1/mobile/owner-device/authentication/challenge")) {
        return new Response(JSON.stringify({ error: "OWNER_DEVICE_CREDENTIAL_REJECTED" }), { status: 401, headers: { "content-type": "application/json" } });
      }
      throw new Error("unexpected request " + value);
    }) as typeof fetch;
    let deleted: string | null = null;
    const native = {
      getSilentDeviceStatus: async () => ({ available: true, canCreate: true, hardwareBacked: true, status: "SILENT_DEVICE_KEY_PRESENT", credentialId: "silent-stale-credential-0123456789" }),
      deleteSilentDeviceCredential: async (credentialId: string) => { deleted = credentialId; },
    } as unknown as OwnerDeviceCredentialNative;
    const session = new MobileApprovedSession(storage, request);
    await assert.rejects(
      () => session.restoreWithSilentDevice(endpoint, "nusa-device-stale-0001", native),
      (error: unknown) => error instanceof Error && error.name === "MobileSessionRequestError",
    );
    assert.equal(deleted, "silent-stale-credential-0123456789");
    assert.equal(storage.values.has(SESSION_STORAGE_KEY), false);
    assert.equal(session.hasMemoryAccess(), false);
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
