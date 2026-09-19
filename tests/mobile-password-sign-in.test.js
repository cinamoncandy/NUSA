"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const ROOT = join(__dirname, "..");
const src = (name) => readFileSync(join(ROOT, "apps/mobile/src", name), "utf8");
const SETTINGS = src("settingsView.tsx");
const SESSION = src("mobileApprovedSession.ts");

const { readServerCapabilities, UNKNOWN_CAPABILITIES } = require("../dist/apps/mobile/src/serverCapabilities.js");

/**
 * Password sign-in is the path that has to work for someone holding only a phone and a memory.
 * These check the two things that would quietly ruin it: keeping the password, and telling the
 * owner "rejected" when the truth is "nobody has set one up here yet".
 */

test("the password is never persisted, only sent", () => {
  assert.match(SESSION, /signInWithOwnerPasswordAndEnrollDeviceCredential/);
  const start = SESSION.indexOf("signInWithOwnerPasswordAndEnrollDeviceCredential");
  const body = SESSION.slice(start, start + 2_400);
  // This branch purged legacy slots with destroyLegacyPersistedCredentials before enrolling. The
  // merge with main replaced that helper: main persists the session through persistOrClear, which
  // writes SESSION_STORAGE_KEY with the new tokens and so overwrites an old device's stored
  // credential rather than deleting it first, and clearLocal() purges on failure. The guarantee
  // this test exists for is unchanged and still asserted below -- the password itself is never
  // written anywhere.
  //
  // KNOWN RESIDUE, recorded rather than dropped: main's success path does not clear
  // PAIRING_STORAGE_KEY, which the old purge did. A stale persisted pairing can outlive a password
  // sign-in. It is inert (a pairing row is single-use and worthless once consumed) but it is a
  // difference, not an equivalence.
  assert.equal(/setSecret|setItem|AsyncStorage/i.test(body), false, "the sign-in path wrote the password to storage");
  assert.doesNotMatch(body, /storage\.(set|write)/i, "the sign-in path must not touch storage directly");
});

test("the field is cleared on success and on failure alike", () => {
  const start = SETTINGS.indexOf("const enrollThisPhone");
  const body = SETTINGS.slice(start, start + 2_000);
  // Success, catch, and finally: a password left in component state outlives the request that
  // needed it, and this screen stays mounted.
  assert.ok((body.match(/setOwnerPassword\(""\)/g) ?? []).length >= 2, "a failed attempt must not leave the password on screen");
  assert.match(body, /finally \{ setOwnerPassword\(""\)/);
});

test("a session is not announced as a connection until the projection is actually read", () => {
  const start = SETTINGS.indexOf("const enrollThisPhone");
  const body = SETTINGS.slice(start, start + 2_000);
  assert.match(body, /loadPersonalPaperOperations/);
  const verifyAt = body.indexOf("loadPersonalPaperOperations");
  const claimAt = body.indexOf("markPaperConnectionVerified");
  assert.ok(verifyAt > 0 && verifyAt < claimAt, "READY was claimed on the issued token alone");
});

test("an unconfigured server is named, so the owner is not told their password is wrong", () => {
  assert.match(SETTINGS, /settings-password-not-configured/);
  assert.match(SETTINGS, /set-owner-password/);
  assert.match(SETTINGS, /capabilities\.passwordSignIn === "NOT_CONFIGURED"/);
});

test("capabilities fail soft: an unreadable server never blocks a sign-in attempt", async () => {
  const responses = {
    "not-json": { ok: true, json: async () => { throw new Error("not json"); } },
    "an array": { ok: true, json: async () => [] },
    "an error": { ok: false, json: async () => ({}) },
    "an older build": { ok: true, json: async () => ({ ok: true, observedAt: "now" }) }
  };
  for (const [label, response] of Object.entries(responses)) {
    const result = await readServerCapabilities("https://paper.example.com", async () => response);
    assert.equal(result.passwordSignIn, "UNKNOWN", `${label} should be UNKNOWN, not a claim`);
  }
  // An older build that cannot report must not be called NOT_CONFIGURED: that would send the owner
  // to run a setup script the deployment does not have.
  assert.equal((await readServerCapabilities("http://insecure.example.com", async () => responses["an older build"])).passwordSignIn, "UNKNOWN");
  assert.deepEqual(await readServerCapabilities("https://paper.example.com", async () => { throw new Error("offline"); }), UNKNOWN_CAPABILITIES);
});

test("capabilities report what a current server says", async () => {
  const payload = { ok: true, deploymentRevision: "a".repeat(40), passwordSignIn: "CONFIGURED" };
  const result = await readServerCapabilities("https://paper.example.com", async () => ({ ok: true, json: async () => payload }));
  assert.equal(result.passwordSignIn, "CONFIGURED");
  assert.equal(result.deploymentRevision, "a".repeat(40));
  const unset = await readServerCapabilities("https://paper.example.com", async () => ({ ok: true, json: async () => ({ ...payload, deploymentRevision: "UNVERIFIED", passwordSignIn: "NOT_CONFIGURED" }) }));
  assert.equal(unset.passwordSignIn, "NOT_CONFIGURED");
  assert.equal(unset.deploymentRevision, null, "UNVERIFIED is not a revision and must not be shown as one");
});
