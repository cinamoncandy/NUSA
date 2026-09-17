const test = require("node:test");
const assert = require("node:assert/strict");

const {
  setConfiguredPaperEndpoint,
  clearConfiguredPaperEndpoint,
  markPaperConnectionVerified,
  isPaperConnectionVerified,
  resumePaperConnection,
} = require("../dist/apps/mobile/src/paperConnectionSession.js");

/**
 * Returning from the background must restore the PAPER session without a token.
 *
 * The restore retry backs off to 30 seconds and Android suspends timers while the app is
 * backgrounded, so a device that spends hours away comes back with a timer the OS never fired or
 * one capped at its slowest interval. Before this, the owner opened the app to a disconnected
 * PAPER server with no action available except reconnecting by hand -- the exact thing the paired
 * session exists to remove.
 *
 * Resume must ask again immediately, must need no token and no owner interaction, and must still
 * fail closed when the stored session has genuinely lapsed.
 */

const ENDPOINT = "https://paper-resume.example.test";

test("resuming with no endpoint configured does nothing and does not throw", () => {
  clearConfiguredPaperEndpoint();
  assert.doesNotThrow(() => resumePaperConnection());
  assert.equal(isPaperConnectionVerified(), false);
});

test("resuming never invents verification for an unrestored session", () => {
  clearConfiguredPaperEndpoint();
  setConfiguredPaperEndpoint(ENDPOINT);
  assert.equal(isPaperConnectionVerified(ENDPOINT), false, "no stored session means not verified");
  resumePaperConnection();
  // Resume may only ask for a restore. A lapsed or absent session stays unverified, so Cloud
  // authority is still refused until the device is approved again.
  assert.equal(isPaperConnectionVerified(ENDPOINT), false, "resume must not grant verification by itself");
  clearConfiguredPaperEndpoint();
});

test("resuming leaves an already verified session alone", () => {
  clearConfiguredPaperEndpoint();
  setConfiguredPaperEndpoint(ENDPOINT);
  markPaperConnectionVerified(ENDPOINT);
  assert.equal(isPaperConnectionVerified(ENDPOINT), true);
  resumePaperConnection();
  assert.equal(isPaperConnectionVerified(ENDPOINT), true, "a working session must survive a resume");
  clearConfiguredPaperEndpoint();
});

test("resume is idempotent and safe to call repeatedly, as foreground events are", () => {
  clearConfiguredPaperEndpoint();
  setConfiguredPaperEndpoint(ENDPOINT);
  assert.doesNotThrow(() => { for (let i = 0; i < 20; i += 1) resumePaperConnection(); });
  assert.equal(isPaperConnectionVerified(ENDPOINT), false);
  clearConfiguredPaperEndpoint();
});

test("resume after disconnect does not revive the cleared endpoint", () => {
  clearConfiguredPaperEndpoint();
  setConfiguredPaperEndpoint(ENDPOINT);
  markPaperConnectionVerified(ENDPOINT);
  clearConfiguredPaperEndpoint();
  resumePaperConnection();
  assert.equal(isPaperConnectionVerified(ENDPOINT), false, "an explicit disconnect must not be undone by a resume");
});

test("the app resumes the PAPER session from its existing foreground handler", () => {
  const fs = require("node:fs");
  const app = fs.readFileSync("apps/mobile/App.tsx", "utf8");
  assert.match(app, /resumePaperConnection/, "App must resume the PAPER session");
  assert.match(app, /if \(nextState === "active"\) resumePaperConnection\(\);/, "resume must run on foreground");
  // One AppState subscription, not a second competing listener.
  assert.equal((app.match(/AppState\.addEventListener/g) || []).length, 1);
});

test("resume requires no token input", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync("apps/mobile/src/paperConnectionSession.ts", "utf8");
  const start = source.indexOf("export function resumePaperConnection");
  assert.ok(start > 0);
  const body = source.slice(start, source.indexOf("\n}", start));
  assert.doesNotMatch(body, /token/i, "resume must not take or handle a token");
});
