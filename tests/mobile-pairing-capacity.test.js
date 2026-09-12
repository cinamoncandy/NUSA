"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { SqliteNusaUserAccessRepository } = require("../dist/apps/cloud/src/operatorUserAccess.js");
const { MobileSessionService } = require("../dist/apps/cloud/src/mobileSessionService.js");

/**
 * `/v1/mobile/pairing/start` takes no credential, and `deviceId` is whatever the caller says:
 * `installationIdentity.ts` generates it locally with `crypto.getRandomValues`. So the global
 * active-pairing cap is reachable by one unauthenticated caller inventing device ids, and while
 * the cap refused new requests, that caller could keep the owner's real phone off the account for
 * the whole TTL and refill to hold it there. Reinstall churn mints fresh installation ids too, so
 * the budget drained without an attacker as well.
 *
 * The cap still bounds the table; it now evicts the oldest PENDING request instead of refusing the
 * newest. An APPROVED request is never evicted -- an owner already acted on it.
 */

const OWNER = Object.freeze({ userId: "owner", email: "owner@nusa.local", scopes: ["users:manage"] });

function fixture() {
  const db = new SqliteDatabase(":memory:");
  const users = new SqliteNusaUserAccessRepository(db);
  users.ensureOwner({ id: OWNER.userId, email: OWNER.email }, 1);
  users.registerUser({ id: "mobile-user", email: "mobile@example.com" }, 2);
  users.changeStatus({ actorUserId: OWNER.userId, targetUserId: "mobile-user", action: "APPROVE", now: 3 });
  return { db, users, service: new MobileSessionService(db, users) };
}

const liveRows = (db, now) =>
  Number(db.connection.prepare("SELECT COUNT(*) AS count FROM mobile_pairing_requests WHERE state IN ('PENDING','APPROVED') AND expires_at>?").get(now).count);

test("an unauthenticated flood of invented device ids cannot lock the owner out", () => {
  const { db, service } = fixture();
  try {
    for (let index = 0; index < 300; index += 1) {
      service.startPairing(`nusa-install-flood-${String(index).padStart(4, "0")}`, 1_000);
    }
    const owner = service.startPairing("nusa-install-owners-real-phone", 1_001);
    assert.equal(owner.state, "PENDING");
    assert.match(owner.verificationCode, /^\d{6}$/);
  } finally {
    db.close();
  }
});

test("eviction keeps the table bounded rather than unbounded", () => {
  const { db, service } = fixture();
  try {
    for (let index = 0; index < 300; index += 1) {
      service.startPairing(`nusa-install-flood-${String(index).padStart(4, "0")}`, 1_000);
    }
    assert.ok(liveRows(db, 1_000) <= 100, `live rows grew to ${liveRows(db, 1_000)}`);
  } finally {
    db.close();
  }
});

test("an approved pairing survives a flood, because the owner already acted on it", () => {
  const { db, service } = fixture();
  try {
    const mine = service.startPairing("nusa-install-owners-real-phone", 1_000);
    assert.equal(service.approvePairing({
      actorUserId: OWNER.userId,
      actorScopes: OWNER.scopes,
      targetUserId: "mobile-user",
      requestId: mine.requestId,
      verificationCode: mine.verificationCode,
      now: 1_001
    }), true);
    for (let index = 0; index < 300; index += 1) {
      service.startPairing(`nusa-install-flood-${String(index).padStart(4, "0")}`, 1_002);
    }
    assert.ok(
      service.exchangePairing(mine.requestId, "nusa-install-owners-real-phone", 1_003) != null,
      "a flood evicted an approval the owner had already granted"
    );
  } finally {
    db.close();
  }
});

test("eviction takes the oldest pending request, not an arbitrary one", () => {
  const { db, service } = fixture();
  try {
    const oldest = service.startPairing("nusa-install-oldest", 1_000);
    for (let index = 0; index < 100; index += 1) {
      service.startPairing(`nusa-install-later-${String(index).padStart(4, "0")}`, 1_000 + index + 1);
    }
    assert.equal(service.pairingStatus(oldest.requestId, "nusa-install-oldest", 1_200).state, "EXPIRED");
  } finally {
    db.close();
  }
});

test("a device still cannot hold two pending requests at once", () => {
  const { db, service } = fixture();
  try {
    const first = service.startPairing("nusa-install-one-device", 1_000);
    const second = service.startPairing("nusa-install-one-device", 1_001);
    assert.notEqual(first.requestId, second.requestId);
    // The retry supersedes rather than accumulating, which is what the per-device cap is for.
    assert.equal(service.pairingStatus(first.requestId, "nusa-install-one-device", 1_002).state, "EXPIRED");
    assert.equal(service.pairingStatus(second.requestId, "nusa-install-one-device", 1_002).state, "PENDING");
  } finally {
    db.close();
  }
});
