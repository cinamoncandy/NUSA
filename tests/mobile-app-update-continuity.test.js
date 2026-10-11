"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * WO-20260924-MOBILE-APP-UPDATE-CONTINUITY.
 *
 * An in-place app update terminates the process, so the first launch of the new version is a cold
 * start. Cold start gets no AppState "change" event, and it restored with the bearer refresh
 * session only: when that had expired, a device whose registered DeviceKey was still valid landed on
 * "PAPER connection required". Update must not be treated as registration or trust loss.
 */

const {
  setConfiguredPaperEndpoint,
  clearConfiguredPaperEndpoint,
  restoreConfiguredPaperSession,
  getPaperSessionState,
} = require("../dist/apps/mobile/src/paperConnectionSession.js");
const { mobileApprovedSession } = require("../dist/apps/mobile/src/mobileApprovedSessionBoundary.js");

const ENDPOINT = "https://paper-update.example.test";
const IDENTITY = Object.freeze({ userId: "owner", email: "owner@example.com", scopes: [] });

function stubSession(overrides) {
  const session = mobileApprovedSession();
  const original = { restore: session.restore, silent: session.restoreWithSilentDevice, retry: session.shouldRetryRestore };
  Object.assign(session, overrides);
  return () => { session.restore = original.restore; session.restoreWithSilentDevice = original.silent; session.shouldRetryRestore = original.retry; };
}

test("first launch after an update restores with the DeviceKey when the refresh session expired", { timeout: 5_000 }, async () => {
  let silentCalls = 0;
  const restoreSession = stubSession({
    restore: async () => null, // expired persisted refresh session: bearer restore finds nothing usable
    restoreWithSilentDevice: async () => { silentCalls += 1; return IDENTITY; },
    shouldRetryRestore: () => false,
  });
  try {
    clearConfiguredPaperEndpoint();
    setConfiguredPaperEndpoint(ENDPOINT);
    const restored = await restoreConfiguredPaperSession(ENDPOINT, { deviceId: "installation-id", native: {} });
    assert.equal(restored, true);
    assert.equal(silentCalls, 1, "cold start must attempt the silent DeviceKey restore");
    assert.equal(getPaperSessionState(), "VERIFIED", "no re-enrollment, no owner interaction, no SETUP");
  } finally {
    clearConfiguredPaperEndpoint();
    restoreSession();
  }
});

test("the silent cold-start restore supersedes the bearer restore started by loading settings", { timeout: 5_000 }, async () => {
  let rejectBearer;
  const restoreSession = stubSession({
    restore: () => new Promise((_resolve, reject) => { rejectBearer = reject; }),
    restoreWithSilentDevice: async () => IDENTITY,
    shouldRetryRestore: () => false,
  });
  try {
    clearConfiguredPaperEndpoint();
    setConfiguredPaperEndpoint(ENDPOINT); // starts a bearer restore, exactly as app start does
    await restoreConfiguredPaperSession(ENDPOINT, { deviceId: "installation-id", native: {} });
    rejectBearer(new Error("stale refresh rejected"));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(getPaperSessionState(), "VERIFIED", "a late bearer failure must not undo the silent restore");
  } finally {
    clearConfiguredPaperEndpoint();
    restoreSession();
  }
});

test("a transient network failure on first launch after an update is RECOVERING, not setup", { timeout: 5_000 }, async () => {
  const restoreSession = stubSession({
    restore: async () => null,
    restoreWithSilentDevice: async () => { throw new Error("network unavailable"); },
    shouldRetryRestore: () => true,
  });
  try {
    clearConfiguredPaperEndpoint();
    setConfiguredPaperEndpoint(ENDPOINT);
    await restoreConfiguredPaperSession(ENDPOINT, { deviceId: "installation-id", native: {} });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(getPaperSessionState(), "RECOVERING");
  } finally {
    clearConfiguredPaperEndpoint();
    restoreSession();
  }
});

test("app cold start passes the DeviceKey context to the canonical restore", () => {
  const app = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/App.tsx"), "utf8");
  const start = app.indexOf("function AuthContextProvider(");
  assert.ok(start > 0);
  const body = app.slice(start, app.indexOf("\n}\n", start));
  assert.match(body, /restoreConfiguredPaperSession\(endpoint, \{ deviceId, native \}\)/, "cold start must use the same silent restore as foreground resume");
  assert.doesNotMatch(body, /restoreWithSilentDevice/, "cold start must go through the session coordinator, not start its own restore");
});
