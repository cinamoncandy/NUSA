"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

// Behavioural contract for resolvePaperAccess (replaces source-text assertions, structural review item 3).
const { resolvePaperAccess } = require("../dist/apps/mobile/src/paperAccessModel.js");

test("public observation stays available without a device session", () => {
  const access = resolvePaperAccess({ deviceSessionVerified: false });
  assert.equal(access.state, "DEVICE_APPROVAL_REQUIRED");
  assert.equal(access.publicObservationAllowed, true);
  assert.equal(access.paperMutationAllowed, false);
  assert.equal(access.deviceSessionVerified, false);
});

test("PAPER mutation requires a verified non-blocked device session", () => {
  const verified = resolvePaperAccess({ deviceSessionVerified: true });
  assert.equal(verified.state, "SECURE_SESSION");
  assert.equal(verified.paperMutationAllowed, true);

  const blocked = resolvePaperAccess({ deviceSessionVerified: true, sessionBlocked: true });
  assert.equal(blocked.state, "BLOCKED");
  assert.equal(blocked.paperMutationAllowed, false, "a blocked session never mutates, even when verified");
  assert.equal(blocked.deviceSessionVerified, false);
  assert.equal(blocked.publicObservationAllowed, true);
});

test("PAPER session never creates LIVE or AI authority, in any state", () => {
  for (const input of [{ deviceSessionVerified: false }, { deviceSessionVerified: true }, { deviceSessionVerified: true, sessionBlocked: true }]) {
    const access = resolvePaperAccess(input);
    assert.equal(access.liveAuthority, "NONE");
    assert.equal(access.productionMutationAllowed, false);
    assert.equal(access.aiAuthority, "ZERO_AUTHORITY");
    assert.ok(Object.isFrozen(access));
  }
});
