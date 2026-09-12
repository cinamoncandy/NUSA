"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CURRENT_COST,
  MAXIMUM_PASSWORD_LENGTH,
  MINIMUM_PASSWORD_LENGTH,
  hashOwnerPassword,
  needsRehash,
  rejectionFor,
  verifyOwnerPassword
} = require("../dist/apps/cloud/src/ownerCredential/ownerPassword.js");

/**
 * A password is the weakest credential this server will accept and the only one an owner can carry
 * in their head. These check the properties that make it safe to accept at all.
 */

const PASSWORD = ["correct", "horse", "battery", "staple"].join(" ");

test("a password verifies against its own hash and nothing else", () => {
  const stored = hashOwnerPassword(PASSWORD);
  assert.equal(verifyOwnerPassword(stored, PASSWORD).status, "ACCEPTED");
  assert.equal(verifyOwnerPassword(stored, `${PASSWORD} `).status, "REJECTED");
  assert.equal(verifyOwnerPassword(stored, PASSWORD.toUpperCase()).status, "REJECTED");
  assert.equal(verifyOwnerPassword(stored, PASSWORD.slice(0, -1)).status, "REJECTED");
});

test("two hashes of the same password differ, so the store never reveals reuse", () => {
  const first = hashOwnerPassword(PASSWORD);
  const second = hashOwnerPassword(PASSWORD);
  assert.notEqual(first, second, "a missing salt would make identical passwords visibly identical");
  assert.equal(verifyOwnerPassword(second, PASSWORD).status, "ACCEPTED");
});

test("the stored hash contains neither the password nor anything decodable back to it", () => {
  const stored = hashOwnerPassword(PASSWORD);
  assert.equal(stored.includes(PASSWORD), false);
  assert.equal(Buffer.from(stored).toString("utf8").includes("horse"), false);
  assert.match(stored, /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
});

test("an absent account is rejected without saying it is absent", () => {
  assert.equal(verifyOwnerPassword(undefined, PASSWORD).status, "REJECTED");
  assert.equal(verifyOwnerPassword("", PASSWORD).status, "REJECTED");
});

test("a corrupted or hostile stored hash fails closed rather than throwing or matching", () => {
  for (const stored of [
    "scrypt$notanumber$8$1$c2FsdA$a2V5",
    "scrypt$32768$8$1$tooshort$a2V5",
    "argon2$32768$8$1$c2FsdA$a2V5",
    "scrypt$32768$8$1$c2FsdA",
    "$$$$$",
    "scrypt$4611686018427387904$8$1$c2FsdA$a2V5"
  ]) {
    assert.equal(verifyOwnerPassword(stored, PASSWORD).status, "REJECTED", `${stored} was not refused`);
  }
});

test("a hash naming a cost large enough to hang the process is refused, not attempted", () => {
  // A corrupted row must not become a denial of service on every login attempt.
  const started = Date.now();
  assert.equal(verifyOwnerPassword("scrypt$1073741824$8$1$c2FsdGluZ3NhbHRpbmc$" + "A".repeat(43), PASSWORD).status, "REJECTED");
  assert.ok(Date.now() - started < 5_000, "an absurd cost was actually attempted");
});

test("non-string candidates are rejected without throwing", () => {
  const stored = hashOwnerPassword(PASSWORD);
  for (const candidate of [undefined, null, 42, {}, [], Buffer.from(PASSWORD), { toString: () => PASSWORD }]) {
    assert.equal(verifyOwnerPassword(stored, candidate).status, "REJECTED", `${String(candidate)} was accepted`);
  }
});

test("length rules are counted in code points, so a Hangul or emoji passphrase is judged fairly", () => {
  const hangul = "가".repeat(MINIMUM_PASSWORD_LENGTH);
  assert.equal(rejectionFor(hangul), undefined);
  assert.equal(rejectionFor("가".repeat(MINIMUM_PASSWORD_LENGTH - 1)), "PASSWORD_TOO_SHORT");
  // Astral characters are two UTF-16 units each; counting units would have called this long enough.
  assert.equal(rejectionFor("🔒".repeat(MINIMUM_PASSWORD_LENGTH - 1)), "PASSWORD_TOO_SHORT");
  assert.equal(rejectionFor("a".repeat(MAXIMUM_PASSWORD_LENGTH + 1)), "PASSWORD_TOO_LONG");
  assert.equal(rejectionFor(12345678901234), "PASSWORD_NOT_A_STRING");
});

test("a password too short to store is also too short to hash", () => {
  assert.throws(() => hashOwnerPassword("short"), /PASSWORD_TOO_SHORT/);
  assert.throws(() => hashOwnerPassword("a".repeat(MAXIMUM_PASSWORD_LENGTH + 1)), /PASSWORD_TOO_LONG/);
});

test("the same passphrase typed on two keyboards still verifies", () => {
  // Hangul and accented Latin have more than one Unicode spelling; without normalization the
  // owner's password would depend on which IME produced it.
  const composed = "café-passphrase-2026";
  const decomposed = composed.normalize("NFD");
  assert.notEqual(composed, decomposed);
  assert.equal(verifyOwnerPassword(hashOwnerPassword(composed), decomposed).status, "ACCEPTED");
});

test("cost is carried by the hash, so raising policy does not lock the owner out", () => {
  const weak = hashOwnerPassword(PASSWORD, { N: CURRENT_COST.N, r: 8, p: 1 });
  const outcome = verifyOwnerPassword(weak, PASSWORD);
  assert.equal(outcome.status, "ACCEPTED");
  assert.equal(outcome.needsRehash, false);
  assert.equal(needsRehash(weak), false);
  // A hash written under a weaker policy than today's still verifies, and asks to be replaced.
  const legacy = weak.replace(`scrypt$${CURRENT_COST.N}$`, "scrypt$16384$");
  assert.equal(needsRehash(legacy), true);
});

test("policy cannot be lowered when writing a new hash", () => {
  assert.throws(() => hashOwnerPassword(PASSWORD, { N: 1024, r: 8, p: 1 }), /must not fall below/);
  assert.throws(() => hashOwnerPassword(PASSWORD, { N: 32_769, r: 8, p: 1 }), /power of two/);
  assert.throws(() => hashOwnerPassword(PASSWORD, { N: CURRENT_COST.N, r: 0, p: 1 }), /positive integers/);
});

test("a wrong password and an unknown account cost comparable time", () => {
  // Response time is the one signal an unauthenticated caller always gets. If a missing account
  // returned early, it would answer "does this account exist" for free.
  const stored = hashOwnerPassword(PASSWORD);
  const time = (run) => { const started = process.hrtime.bigint(); run(); return Number(process.hrtime.bigint() - started); };
  const wrong = time(() => verifyOwnerPassword(stored, "definitely-not-the-password"));
  const absent = time(() => verifyOwnerPassword(undefined, "definitely-not-the-password"));
  const ratio = Math.max(wrong, absent) / Math.max(1, Math.min(wrong, absent));
  assert.ok(ratio < 3, `timing differed by ${ratio.toFixed(1)}x between a wrong password and no account`);
});
