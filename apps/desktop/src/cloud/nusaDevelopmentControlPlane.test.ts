import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NUSA_DEVELOPMENT_CONTROL_PLANE_AUTHORITY,
  claimNextNusaDevelopmentWork,
  createNusaDevelopmentQueue,
  recoverStaleNusaDevelopmentClaims,
  type NusaDevelopmentWorkItem,
} from "./nusaDevelopmentControlPlane";

const T0 = Date.parse("2026-08-27T12:00:00.000Z");

function work(overrides: Partial<NusaDevelopmentWorkItem> & Pick<NusaDevelopmentWorkItem, "id">): NusaDevelopmentWorkItem {
  return {
    id: overrides.id,
    state: overrides.state ?? "READY",
    priority: overrides.priority ?? "P1",
    dependencies: overrides.dependencies ?? [],
    canonicalOwner: overrides.canonicalOwner ?? null,
    touchedFiles: overrides.touchedFiles ?? [`${overrides.id}.ts`],
    evidenceRequirements: overrides.evidenceRequirements ?? ["targeted-test", "exact-head-ci"],
    nextAction: overrides.nextAction ?? "claim",
    createdAt: overrides.createdAt ?? T0,
    claim: overrides.claim ?? null,
  };
}

describe("NUSA canonical development queue", () => {
  it("uses the complete #903 state vocabulary and preserves zero live authority", () => {
    const states = ["READY", "CLAIMED", "IMPLEMENTING", "VALIDATING", "CI", "MERGE_READY", "MERGED", "BLOCKED_HUMAN"] as const;
    const queue = createNusaDevelopmentQueue(states.map((state, index) => work({ id: `w${index}`, state })));
    assert.deepEqual(queue.items.map((item) => item.state), states);
    assert.deepEqual(NUSA_DEVELOPMENT_CONTROL_PLANE_AUTHORITY, {
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    });
  });

  it("claims deterministically by priority, creation time, then stable id", () => {
    const queue = createNusaDevelopmentQueue([
      work({ id: "later-p0", priority: "P0", createdAt: T0 + 1 }),
      work({ id: "b", priority: "P0", createdAt: T0 }),
      work({ id: "a", priority: "P0", createdAt: T0 }),
      work({ id: "p1", priority: "P1", createdAt: T0 - 10_000 }),
    ]);
    const result = claimNextNusaDevelopmentWork(queue, {
      owner: "development",
      requestId: "run-1",
      expectedRevision: 0,
      now: T0 + 100,
      leaseMs: 60_000,
    });
    assert.equal(result.status, "CLAIMED");
    assert.equal(result.item?.id, "a");
    assert.equal(result.queue.revision, 1);
  });

  it("blocks unmet dependencies and unlocks only after canonical dependency state is MERGED", () => {
    const blocked = createNusaDevelopmentQueue([
      work({ id: "base", state: "CI", priority: "P0" }),
      work({ id: "dependent", priority: "P0", dependencies: ["base"] }),
      work({ id: "fallback", priority: "P1" }),
    ]);
    const blockedResult = claimNextNusaDevelopmentWork(blocked, {
      owner: "development",
      requestId: "run-blocked",
      expectedRevision: 0,
      now: T0,
      leaseMs: 60_000,
    });
    assert.equal(blockedResult.item?.id, "fallback");

    const unblocked = createNusaDevelopmentQueue([
      work({ id: "base", state: "MERGED", priority: "P0" }),
      work({ id: "dependent", priority: "P0", dependencies: ["base"] }),
    ]);
    const unblockedResult = claimNextNusaDevelopmentWork(unblocked, {
      owner: "development",
      requestId: "run-unblocked",
      expectedRevision: 0,
      now: T0,
      leaseMs: 60_000,
    });
    assert.equal(unblockedResult.item?.id, "dependent");
  });

  it("makes the same claim request idempotent and rejects stale competing revisions", () => {
    const queue = createNusaDevelopmentQueue([work({ id: "p0", priority: "P0" })]);
    const request = {
      owner: "development",
      requestId: "run-idempotent",
      expectedRevision: 0,
      now: T0,
      leaseMs: 60_000,
    } as const;
    const first = claimNextNusaDevelopmentWork(queue, request);
    assert.equal(first.status, "CLAIMED");

    const replay = claimNextNusaDevelopmentWork(first.queue, request);
    assert.equal(replay.status, "IDEMPOTENT_REPLAY");
    assert.equal(replay.queue, first.queue);
    assert.equal(replay.item?.id, "p0");

    const competing = claimNextNusaDevelopmentWork(first.queue, {
      ...request,
      owner: "qa",
      requestId: "run-competing",
    });
    assert.equal(competing.status, "REVISION_CONFLICT");
    assert.equal(competing.item, null);
  });

  it("recovers expired claims deterministically and recovery itself is idempotent", () => {
    const claimed = claimNextNusaDevelopmentWork(
      createNusaDevelopmentQueue([work({ id: "stale", priority: "P0", nextAction: "implement" })]),
      { owner: "development", requestId: "run-stale", expectedRevision: 0, now: T0, leaseMs: 1_000 },
    );
    assert.equal(claimed.status, "CLAIMED");

    const beforeExpiry = recoverStaleNusaDevelopmentClaims(claimed.queue, T0 + 999);
    assert.equal(beforeExpiry, claimed.queue);

    const recovered = recoverStaleNusaDevelopmentClaims(claimed.queue, T0 + 1_000);
    assert.equal(recovered.revision, 2);
    assert.equal(recovered.items[0]?.state, "READY");
    assert.equal(recovered.items[0]?.canonicalOwner, null);
    assert.equal(recovered.items[0]?.claim, null);
    assert.equal(recovered.items[0]?.nextAction, "claim");

    const replay = recoverStaleNusaDevelopmentClaims(recovered, T0 + 1_000);
    assert.equal(replay, recovered);
  });

  it("fails closed on unsafe claim and recovery timestamps while preserving the safe integer boundary", () => {
    const queue = createNusaDevelopmentQueue([work({ id: "safe-boundary", priority: "P0" })]);

    assert.throws(() => claimNextNusaDevelopmentWork(queue, {
      owner: "qa",
      requestId: "unsafe-now",
      expectedRevision: 0,
      now: Number.MAX_VALUE,
      leaseMs: 1,
    }), /CLAIM_NOW_INVALID/);

    assert.throws(() => claimNextNusaDevelopmentWork(queue, {
      owner: "qa",
      requestId: "unsafe-lease",
      expectedRevision: 0,
      now: T0,
      leaseMs: Number.MAX_SAFE_INTEGER,
    }), /CLAIM_LEASE_EXPIRES_AT_INVALID/);

    assert.throws(() => claimNextNusaDevelopmentWork(queue, {
      owner: "qa",
      requestId: "fractional-lease",
      expectedRevision: 0,
      now: T0,
      leaseMs: 1.5,
    }), /CLAIM_LEASE_INVALID/);

    assert.throws(() => recoverStaleNusaDevelopmentClaims(queue, Number.MAX_VALUE), /STALE_RECOVERY_NOW_INVALID/);

    const boundary = claimNextNusaDevelopmentWork(queue, {
      owner: "qa",
      requestId: "safe-boundary",
      expectedRevision: 0,
      now: Number.MAX_SAFE_INTEGER - 1,
      leaseMs: 1,
    });
    assert.equal(boundary.status, "CLAIMED");
    assert.equal(boundary.item.claim?.leaseExpiresAt, Number.MAX_SAFE_INTEGER);
  });

  it("fails closed on non-canonical work creation timestamps", () => {
    assert.throws(() => createNusaDevelopmentQueue([work({ id: "unsafe-created", createdAt: Number.MAX_VALUE })]), /WORK_CREATED_AT_INVALID/);
    assert.throws(() => createNusaDevelopmentQueue([work({ id: "fractional-created", createdAt: T0 + 0.5 })]), /WORK_CREATED_AT_INVALID/);
  });

  it("fails closed on duplicate ids and unknown dependencies", () => {
    assert.throws(() => createNusaDevelopmentQueue([work({ id: "same" }), work({ id: "same" })]), /WORK_ID_DUPLICATE/);
    assert.throws(() => createNusaDevelopmentQueue([work({ id: "dependent", dependencies: ["missing"] })]), /WORK_DEPENDENCY_UNKNOWN/);
  });
});
