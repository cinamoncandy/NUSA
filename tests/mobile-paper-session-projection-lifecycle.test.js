"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

/**
 * Behavioural contract (replaces source-text assertions, structural review item 3): a PAPER
 * projection outcome is reported separately from authentication, so a stale or failed read never
 * revokes an authenticated session, while an explicit rejection or endpoint change still does.
 */
const { InMemoryDashboardCredentialSession, setDashboardCredentialEndpoint } = require("../dist/apps/mobile/src/dashboardCredentialSession.js");
const { mobileApprovedSession } = require("../dist/apps/mobile/src/mobileApprovedSessionBoundary.js");
const { loadPersonalPaperOperations } = require("../dist/apps/mobile/src/personalPaperOperationsClient.js");
const { setConfiguredPaperEndpoint, clearConfiguredPaperEndpoint } = require("../dist/apps/mobile/src/paperConnectionSession.js");

const ENDPOINT = "https://paper-projection.example.test";
const TOKEN = "bootstrap-token-0123456789abcdef";

function harness() {
  const session = mobileApprovedSession();
  const original = {};
  const calls = [];
  for (const name of ["connectBootstrap", "credentialProvider", "disconnect", "clearMemory", "enroll", "shouldRetryRestore", "hasMemoryAccess"]) original[name] = session[name];
  Object.assign(session, {
    connectBootstrap: async () => { calls.push("connectBootstrap"); return { userId: "owner" }; },
    disconnect: async (endpoint) => { calls.push(`disconnect:${endpoint}`); },
    clearMemory: () => { calls.push("clearMemory"); },
    enroll: async () => { calls.push("enroll"); },
    shouldRetryRestore: () => false,
    hasMemoryAccess: () => true,
  });
  Object.defineProperty(session, "credentialProvider", { value: async () => "access-token", configurable: true, writable: true });
  return {
    calls,
    restore() {
      setDashboardCredentialEndpoint(null);
      for (const [name, value] of Object.entries(original)) Object.defineProperty(session, name, { value, configurable: true, writable: true });
    },
  };
}

async function authenticated(h) {
  setDashboardCredentialEndpoint(null);
  setDashboardCredentialEndpoint(ENDPOINT);
  const credentials = new InMemoryDashboardCredentialSession();
  credentials.connect(TOKEN);
  assert.equal(await credentials.credentialProvider(), "access-token");
  h.calls.length = 0;
  return credentials;
}

test("a failed PAPER projection after authentication preserves the encrypted session", async () => {
  const h = harness();
  try {
    const credentials = await authenticated(h);
    credentials.credentialProvider.noteProjectionResult("PROJECTION_UNAVAILABLE");
    credentials.clear();
    assert.deepEqual(h.calls, ["clearMemory"], "only ephemeral access is dropped; no disconnect");
  } finally { h.restore(); }
});

test("an explicit auth rejection lets clear() destroy the session", async () => {
  const h = harness();
  try {
    const credentials = await authenticated(h);
    credentials.credentialProvider.noteProjectionResult("AUTH_REJECTED");
    credentials.clear();
    assert.ok(h.calls.includes(`disconnect:${ENDPOINT}`));
  } finally { h.restore(); }
});

test("enrollment waits for a pending wipe so the wipe cannot erase the new session", async () => {
  const h = harness();
  let releaseDisconnect;
  mobileApprovedSession().disconnect = () => new Promise((resolve) => { releaseDisconnect = () => { h.calls.push("disconnect-done"); resolve(); }; });
  try {
    const credentials = await authenticated(h);
    credentials.clear();
    const enrolled = credentials.enroll("owner-credential-0123456789", "device-id");
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(!h.calls.includes("enroll"), "enroll must not start before the wipe finishes");
    releaseDisconnect();
    await enrolled;
    assert.ok(h.calls.indexOf("disconnect-done") < h.calls.indexOf("enroll"));
  } finally { h.restore(); }
});

test("an explicit endpoint change destroys the old encrypted session", () => {
  const h = harness();
  try {
    setDashboardCredentialEndpoint(null);
    setDashboardCredentialEndpoint(ENDPOINT);
    setDashboardCredentialEndpoint("https://other-paper.example.test");
    assert.ok(h.calls.includes(`disconnect:${ENDPOINT}`));
  } finally { h.restore(); }
});

test("the PAPER client reports 401/403 as AUTH_REJECTED and other failures as PROJECTION_UNAVAILABLE", async () => {
  const session = mobileApprovedSession();
  const originalRestore = session.restore;
  session.restore = async () => null;
  clearConfiguredPaperEndpoint();
  setConfiguredPaperEndpoint(ENDPOINT);
  try {
  for (const [status, expected] of [[401, "AUTH_REJECTED"], [403, "AUTH_REJECTED"], [503, "PROJECTION_UNAVAILABLE"]]) {
    const outcomes = [];
    const provider = Object.assign(async () => "access-token", { noteProjectionResult: (outcome) => outcomes.push(outcome) });
    const result = await loadPersonalPaperOperations({
      baseUrl: ENDPOINT,
      credentialProvider: provider,
      allowUnverifiedEndpoint: true,
      request: async () => new Response(JSON.stringify({ error: "x" }), { status, headers: { "content-type": "application/json" } }),
    });
    assert.notEqual(result.status, "READY");
    assert.deepEqual(outcomes, [expected], `HTTP ${status}`);
  }
  } finally {
    clearConfiguredPaperEndpoint();
    session.restore = originalRestore;
  }
});
