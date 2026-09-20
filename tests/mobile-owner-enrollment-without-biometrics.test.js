"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const { MobileApprovedSession } = require("../dist/apps/mobile/src/mobileApprovedSession.js");

const ENDPOINT = "https://paper.example.com";
const DEVICE = "a".repeat(32);
const SIGNATURE = Buffer.from("owner-device-proof-bytes").toString("base64");

/**
 * The owner could not get past the device-credential prompt, and the enrollment path answered by
 * discarding the session the server had already issued against a correct owner password. These pin
 * the rule that replaced it: a local hardware-key failure costs silent reconnect, never the
 * server-granted session, and never storage.
 */

function tokens(overrides = {}) {
  return {
    accessToken: "access-" + "b".repeat(24),
    accessExpiresAt: Date.now() + 600_000,
    refreshToken: "refresh-" + "c".repeat(24),
    refreshExpiresAt: Date.now() + 3_600_000,
    scopes: ["users:manage", "paper:trade"],
    deviceId: DEVICE,
    ...overrides
  };
}

function stubServer(seen) {
  return async (url, init) => {
    seen.push(String(url));
    const path = String(url).slice(ENDPOINT.length);
    const body = path === "/v1/mobile/me"
      ? { userId: "owner-1", email: "owner@example.com", scopes: ["users:manage", "paper:trade"] }
      : path.endsWith("/registration/challenge") || path.endsWith("/authentication/challenge")
        ? { challengeId: "d".repeat(32), challenge: Buffer.from("server-challenge-bytes").toString("base64"), purpose: path.includes("registration") ? "REGISTRATION" : "AUTHENTICATION", expiresAt: Date.now() + 60_000 }
        : tokens();
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
}

function nativeThatFails(error) {
  return {
    getStatus: async () => ({ available: false, canCreate: true, hardwareBacked: false, status: "CREDENTIAL_NOT_REGISTERED", credentialId: null }),
    createCredential: async () => { throw error; },
    signChallenge: async () => { throw error; },
    deleteCredential: async () => undefined
  };
}

function nativeRejection() {
  // React Native surfaces promise.reject(code, message) as an Error carrying `code`.
  const error = new Error("Owner authentication could not start.");
  error.code = "E_NUSA_OWNER_DEVICE_CREDENTIAL_SIGN";
  return error;
}

test("a device-credential failure keeps the password session the server already issued", async () => {
  const seen = [];
  const storage = { setSecret: async () => { throw new Error("storage must not be written"); }, getSecret: async () => null, deleteSecret: async () => undefined };
  const session = new MobileApprovedSession(storage, stubServer(seen));
  const identity = await session.signInWithOwnerPasswordAndEnrollDeviceCredential(ENDPOINT, "owner-password", DEVICE, nativeThatFails(nativeRejection()));
  assert.equal(identity.userId, "owner-1");
  assert.ok(identity.scopes.includes("paper:trade"), "the server-granted scopes are what the session carries");
  assert.ok((await session.getAccessToken()).startsWith("access-"), "the password session stays usable in memory");
  // The password path was reached; the registration activate call was not.
  assert.ok(seen.some((url) => url.endsWith("/v1/mobile/session/password")));
  assert.equal(seen.some((url) => url.includes("/registration/activate")), false);
});

test("the fallback session is memory-only: nothing is written to secure storage", async () => {
  const writes = [];
  const storage = { setSecret: async (key) => { writes.push(key); }, getSecret: async () => null, deleteSecret: async () => undefined };
  const session = new MobileApprovedSession(storage, stubServer([]));
  await session.signInWithOwnerPasswordAndEnrollDeviceCredential(ENDPOINT, "owner-password", DEVICE, nativeThatFails(nativeRejection()));
  assert.deepEqual(writes, [], "a session with no hardware key must not survive a relaunch");
});

test("a server refusal is still fatal -- only local hardware failures fall back", async () => {
  const { MobileSessionRequestError } = require("../dist/apps/mobile/src/mobileApprovedSession.js");
  const session = new MobileApprovedSession(null, async (url) => {
    if (String(url).endsWith("/v1/mobile/session/password")) return { ok: true, status: 200, json: async () => tokens(), text: async () => "" };
    return { ok: false, status: 403, json: async () => ({ refusal: "USER_NOT_ACTIVE" }), text: async () => JSON.stringify({ refusal: "USER_NOT_ACTIVE" }) };
  });
  const native = {
    getStatus: async () => ({ available: false, canCreate: true, hardwareBacked: false, status: "CREDENTIAL_NOT_REGISTERED", credentialId: null }),
    createCredential: async () => ({ credentialId: "e".repeat(48), publicKeySpki: Buffer.from("spki-bytes-long-enough").toString("base64"), hardwareBacked: true }),
    signChallenge: async () => SIGNATURE,
    deleteCredential: async () => undefined
  };
  await assert.rejects(
    () => session.signInWithOwnerPasswordAndEnrollDeviceCredential(ENDPOINT, "owner-password", DEVICE, native),
    (error) => !(error instanceof MobileSessionRequestError && false) && error instanceof Error,
    "a server that refuses the owner must not be downgraded into a local-failure fallback"
  );
  assert.equal(await session.getAccessToken().catch(() => null), null, "a refused enrollment leaves no session");
});

test("the fallback is announced in the UI rather than looking like a full enrollment", () => {
  const settings = readFileSync(join(__dirname, "..", "apps/mobile/src/settingsView.tsx"), "utf8");
  assert.match(settings, /settings-owner-password-only-session/);
  assert.match(settings, /비밀번호로만 연결되어 있습니다/);
});
