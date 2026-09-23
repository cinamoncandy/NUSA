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

test("resuming revalidates even when the process-local endpoint was already verified", () => {
  clearConfiguredPaperEndpoint();
  setConfiguredPaperEndpoint(ENDPOINT);
  markPaperConnectionVerified(ENDPOINT);
  assert.equal(isPaperConnectionVerified(ENDPOINT), true);
  resumePaperConnection();
  assert.equal(isPaperConnectionVerified(ENDPOINT), true, "revalidation must not invent a disconnect synchronously");
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
  assert.match(app, /if \(nextState === "active"\)/, "resume must run on foreground");
  assert.match(app, /getOrCreateInstallationId/, "foreground recovery must reuse the persisted installation identity");
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


test("a scheduled restore retry repeats the same silent-device attempt, not a downgraded bearer restore", () => {
  // Regression for a real Galaxy device report: a retry scheduled after a failed foreground resume
  // called restoreApprovedSession(endpoint) with no force/silent context, silently downgrading
  // every retry to the bearer-refresh restore() path. A device whose silent DeviceKey check failed
  // only transiently (a Keystore hiccup right after Doze/background) then depended on a persisted
  // bearer refresh surviving background too, which foreground resume does not rely on by design --
  // so the retry could never actually repeat the attempt that failed.
  const fs = require("node:fs");
  const source = fs.readFileSync("apps/mobile/src/paperConnectionSession.ts", "utf8");
  const signatureStart = source.indexOf("function scheduleRestoreRetry(");
  assert.ok(signatureStart > 0, "expected scheduleRestoreRetry to exist");
  const signatureEnd = source.indexOf(")", signatureStart);
  const signature = source.slice(signatureStart, signatureEnd);
  assert.match(signature, /force:\s*boolean/, "scheduleRestoreRetry must accept the force flag of the attempt it is retrying");
  assert.match(signature, /silent\?:/, "scheduleRestoreRetry must accept the silent DeviceKey context of the attempt it is retrying");
  const calls = (source.match(/scheduleRestoreRetry\([^)]*\)/g) || []).filter((call) => !call.startsWith("scheduleRestoreRetry(endpoint: string"));
  assert.ok(calls.length >= 2, "expected at least the immediate-failure and single-flight-cleared call sites");
  for (const call of calls) {
    assert.match(call, /scheduleRestoreRetry\(endpoint,\s*force,\s*silent\)/, `every scheduleRestoreRetry call must forward force/silent, found: ${call}`);
  }
  // The retry timer itself must repeat the same attempt, not just receive the context and drop it.
  const bodyStart = source.indexOf("restoreRetryTimer = setTimeout(", signatureStart);
  assert.ok(bodyStart > signatureStart, "expected scheduleRestoreRetry to arm a retry timer");
  const bodyEnd = source.indexOf("}, delay);", bodyStart);
  const timerBody = source.slice(bodyStart, bodyEnd);
  assert.match(timerBody, /restoreApprovedSession\(endpoint,\s*force,\s*silent\)/, "the retry timer must call restoreApprovedSession with the same force/silent it was armed with");
});

test("resume does not trust VERIFIED as proof of a live credential", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync("apps/mobile/src/paperConnectionSession.ts", "utf8");
  const start = source.indexOf("export function resumePaperConnection");
  const body = source.slice(start, source.indexOf("\n}", start));
  assert.doesNotMatch(body, /if \(isPaperConnectionVerified\(endpoint\)\) return/, "foreground must revalidate stale process-local verification");
  assert.match(body, /restoreApprovedSession\(endpoint, true, silent\)/, "foreground recovery must force a single-flight revalidation");
});

test("an explicit verification is not undone by a slower restore that fails afterwards", async () => {
  // Galaxy report: connect had to be pressed several times. Saving Settings starts a restore;
  // the connect button then verified the session; the earlier restore failing later cleared it.
  const { mobileApprovedSession } = require("../dist/apps/mobile/src/mobileApprovedSessionBoundary.js");
  const session = mobileApprovedSession();
  const originalRestore = session.restore;
  const originalRetryable = session.shouldRetryRestore;
  let rejectRestore;
  try {
    clearConfiguredPaperEndpoint();
    session.restore = () => new Promise((_resolve, reject) => { rejectRestore = reject; });
    session.shouldRetryRestore = () => true;
    setConfiguredPaperEndpoint(ENDPOINT);
    markPaperConnectionVerified(ENDPOINT);
    rejectRestore(new Error("late network failure"));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(isPaperConnectionVerified(ENDPOINT), true);
  } finally {
    clearConfiguredPaperEndpoint();
    session.restore = originalRestore;
    session.shouldRetryRestore = originalRetryable;
  }
});
