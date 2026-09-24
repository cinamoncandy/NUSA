"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

/**
 * Owner report 2026-09-24 (real Galaxy): after reopening the app PAPER first shows as
 * disconnected, then becomes authenticated. The restore itself succeeded; the screen only
 * re-read the session state on its 5 s poll. A verified restore must notify the UI at once.
 */
const {
  setConfiguredPaperEndpoint,
  clearConfiguredPaperEndpoint,
  resumePaperConnection,
  subscribePaperSessionVerified,
  getPaperSessionState,
} = require("../dist/apps/mobile/src/paperConnectionSession.js");
const { mobileApprovedSession } = require("../dist/apps/mobile/src/mobileApprovedSessionBoundary.js");

const ENDPOINT = "https://paper-notify.example.test";
const IDENTITY = Object.freeze({ userId: "owner", email: "owner@example.com", scopes: [] });

test("a foreground restore that verifies notifies subscribers immediately", { timeout: 5_000 }, async () => {
  const session = mobileApprovedSession();
  const original = { restore: session.restore, silent: session.restoreWithSilentDevice, retry: session.shouldRetryRestore };
  let releaseSilent;
  session.restore = async () => null;
  session.restoreWithSilentDevice = () => new Promise((resolve) => { releaseSilent = () => resolve(IDENTITY); });
  session.shouldRetryRestore = () => false;
  const seen = [];
  const unsubscribe = subscribePaperSessionVerified(() => seen.push(getPaperSessionState()));
  try {
    clearConfiguredPaperEndpoint();
    setConfiguredPaperEndpoint(ENDPOINT);
    await new Promise((resolve) => setImmediate(resolve));
    seen.length = 0;
    resumePaperConnection({ deviceId: "installation-id", native: {} });
    assert.equal(getPaperSessionState(), "RECOVERING");
    assert.deepEqual(seen, []);
    releaseSilent();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(seen, ["VERIFIED"], "the UI must learn about the verified session without waiting for a poll");
  } finally {
    unsubscribe();
    clearConfiguredPaperEndpoint();
    Object.assign(session, { restore: original.restore, restoreWithSilentDevice: original.silent, shouldRetryRestore: original.retry });
  }
});

test("an unsubscribed listener is not called", { timeout: 5_000 }, async () => {
  const session = mobileApprovedSession();
  const original = session.restore;
  session.restore = async () => IDENTITY;
  let calls = 0;
  const unsubscribe = subscribePaperSessionVerified(() => { calls += 1; });
  unsubscribe();
  try {
    clearConfiguredPaperEndpoint();
    setConfiguredPaperEndpoint(ENDPOINT);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(getPaperSessionState(), "VERIFIED");
    assert.equal(calls, 0);
  } finally {
    clearConfiguredPaperEndpoint();
    session.restore = original;
  }
});
