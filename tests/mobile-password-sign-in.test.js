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
  assert.match(SESSION, /signInWithPassword/);
  const start = SESSION.indexOf("public async signInWithPassword");
  const body = SESSION.slice(start, SESSION.indexOf("public async enroll"));
  assert.match(body, /destroyLegacyPersistedCredentials/, "a stale persisted credential must be purged first");
  // Purging old credentials is the one storage call allowed here; anything else would be a write.
  const withoutPurge = body.replace(/destroyLegacyPersistedCredentials/g, "");
  assert.equal(/storage|setItem|AsyncStorage|persist/i.test(withoutPurge), false, "the sign-in path wrote to storage");
});

test("the field is cleared on success and on failure alike", () => {
  const start = SETTINGS.indexOf("const signInWithPassword");
  const body = SETTINGS.slice(start, start + 2_000);
  assert.equal((body.match(/setPasswordDraft\(""\)/g) ?? []).length, 2, "a failed attempt must not leave the password on screen");
  // Read once before the awaits: the field is cleared while the request is still in flight.
  assert.match(body, /const password = passwordDraft;/);
});

test("a session is not announced as a connection until the projection is actually read", () => {
  const start = SETTINGS.indexOf("const signInWithPassword");
  const body = SETTINGS.slice(start, start + 2_000);
  assert.match(body, /loadPersonalPaperOperations/);
  const verifyAt = body.indexOf("loadPersonalPaperOperations");
  const claimAt = body.indexOf("markPaperConnectionVerified");
  assert.ok(verifyAt > 0 && verifyAt < claimAt, "READY was claimed on the token alone");
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
