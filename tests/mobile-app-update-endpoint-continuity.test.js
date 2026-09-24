"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

/**
 * Real-device P0: an in-place app update dropped PAPER server authentication.
 *
 * Release builds save paperEndpoint "" and use the build's canonical origin. Every settings load
 * applied the raw "" and so flipped the configured endpoint canonical -> none -> canonical. The flip
 * reads as an explicit endpoint change, which destroys the encrypted session by design
 * (disconnect -> clearLocal deletes the persisted refresh session). App start runs several settings
 * loads, so the first launch after an update deleted a still-valid session.
 *
 * APP_UPDATE != endpoint change: restoring persisted settings must never destroy the session.
 */
const CANONICAL = "https://paper-canonical.example.test";
process.env.EXPO_PUBLIC_NUSA_API_BASE_URL = CANONICAL;

const { VersionedSettingsRepository } = require("../dist/apps/mobile/src/persistenceRepositories.js");
const { setConfiguredPaperEndpoint, clearConfiguredPaperEndpoint, getConfiguredPaperEndpoint } = require("../dist/apps/mobile/src/paperConnectionSession.js");
const { mobileApprovedSession } = require("../dist/apps/mobile/src/mobileApprovedSessionBoundary.js");
const { effectivePaperEndpoint, resolveCanonicalCloudOrigin } = require("../dist/apps/mobile/src/canonicalOrigin.js");

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: async (key) => values.get(key) ?? null, setItem: async (key, value) => { values.set(key, value); } };
}

function spySession() {
  const session = mobileApprovedSession();
  const original = { disconnect: session.disconnect, restore: session.restore };
  const disconnects = [];
  session.disconnect = async (endpoint) => { disconnects.push(endpoint); };
  session.restore = async () => null;
  return { disconnects, restore() { session.disconnect = original.disconnect; session.restore = original.restore; } };
}

test("the canonical origin is the effective endpoint when none was saved", () => {
  assert.equal(effectivePaperEndpoint("", resolveCanonicalCloudOrigin()), CANONICAL);
  assert.equal(effectivePaperEndpoint("https://explicit.example.test", resolveCanonicalCloudOrigin()), "https://explicit.example.test");
  assert.equal(effectivePaperEndpoint("", { status: "DEPLOYMENT_CONFIG_PENDING", reason: "x" }), "");
});

test("cold start settings loads never destroy the PAPER session (first launch after an app update)", async () => {
  const spy = spySession();
  try {
    clearConfiguredPaperEndpoint();
    spy.disconnects.length = 0;
    const repository = new VersionedSettingsRepository(memoryStorage());
    await repository.save({ paperEndpoint: "" }); // what a release build persists
    spy.disconnects.length = 0;
    // App start: the auth path configures the canonical origin, then other providers load settings.
    setConfiguredPaperEndpoint(CANONICAL);
    await Promise.all([repository.load(), repository.load(), repository.load(), repository.load()]);
    assert.equal(getConfiguredPaperEndpoint(), CANONICAL, "the endpoint never flips to none");
    assert.deepEqual(spy.disconnects, [], "no destructive disconnect during settings restore");
  } finally {
    clearConfiguredPaperEndpoint();
    spy.restore();
  }
});

test("an explicit change to a different endpoint still destroys the old session", async () => {
  const spy = spySession();
  try {
    clearConfiguredPaperEndpoint();
    setConfiguredPaperEndpoint(CANONICAL);
    spy.disconnects.length = 0;
    await new VersionedSettingsRepository(memoryStorage()).save({ paperEndpoint: "https://other-paper.example.test" });
    assert.deepEqual(spy.disconnects, [CANONICAL]);
  } finally {
    clearConfiguredPaperEndpoint();
    spy.restore();
  }
});
