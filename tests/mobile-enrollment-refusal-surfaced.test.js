"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const { describeCredentialFailure } = require("../dist/apps/mobile/src/dashboardCredentialSession.js");
const { MobileSessionRequestError } = require("../dist/apps/mobile/src/mobileApprovedSession.js");

/**
 * The server names which account state refused enrollment, and the app already carried that
 * code on the error. The settings screen rendered `error.message` raw, so all three 403 states
 * reached the operator as a bare "(403)" -- pointing at the token even when the token had been
 * accepted and the account was the problem. These cover both halves of the fix: the message
 * itself now carries the code, and the settings surface routes through the mapper.
 */

test("the refusal code travels in the error message, not only in the field", () => {
  for (const refusal of ["USER_NOT_REGISTERED", "USER_NOT_ACTIVE", "USER_IDENTITY_MISMATCH"]) {
    const error = new MobileSessionRequestError(403, refusal);
    assert.equal(error.refusal, refusal);
    assert.match(error.message, /^mobile session request rejected \(403: [A-Z_]+\)\.$/);
    assert.ok(error.message.includes(refusal));
  }
});

test("a refusal-less rejection keeps the original message shape", () => {
  assert.equal(new MobileSessionRequestError(429).message, "mobile session request rejected (429).");
});

test("each 403 account state maps to its own operator-facing sentence", () => {
  const seen = new Set();
  for (const refusal of ["USER_NOT_REGISTERED", "USER_NOT_ACTIVE", "USER_IDENTITY_MISMATCH"]) {
    const described = describeCredentialFailure(new MobileSessionRequestError(403, refusal));
    // The generic token-expiry sentence is the wrong advice for every one of these states.
    assert.doesNotMatch(described, /토큰이 만료/);
    seen.add(described);
  }
  assert.equal(seen.size, 3);
});

test("an unnamed 403 still yields actionable text rather than a bare status", () => {
  const described = describeCredentialFailure(new MobileSessionRequestError(403));
  assert.ok(described.length > 0);
  assert.doesNotMatch(described, /^mobile session request rejected/);
});
