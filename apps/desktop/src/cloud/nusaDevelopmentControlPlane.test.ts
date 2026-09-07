import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NUSA_DEVELOPMENT_CONTROL_PLANE_AUTHORITY,
  claimNusaDevelopmentWorkPortfolio,
  claimNextNusaDevelopmentWork,
  createNusaDevelopmentQueue,
  recoverStaleNusaDevelopmentClaims,
  recoverStaleNusaDevelopmentClaimWithEvidence,
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
    const states = ["READY", "CLAIMED", "IMPLEMENTING", "VALIDATING", "CI", "AUDIT", "MERGE_READY", "MERGED", "BLOCKED_HUMAN"] as const;
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

  it("skips higher-priority file-conflicting work and uses safe overflow", () => {
    const queue = createNusaDevelopmentQueue([
      work({ id: "active", state: "IMPLEMENTING", priority: "P0", canonicalOwner: "research", touchedFiles: ["shared.ts"] }),
      work({ id: "conflicting", priority: "P0", touchedFiles: ["shared.ts"] }),
      work({ id: "safe-overflow", priority: "P1", touchedFiles: ["independent.ts"] }),
    ]);
    const result = claimNextNusaDevelopmentWork(queue, {
      owner: "development",
      requestId: "conflict-aware",
      expectedRevision: 0,
      now: T0,
      leaseMs: 60_000,
      allocationPolicy: { maximumActiveWorkPerOwner: 2, preventTouchedFileConflicts: true },
    });
    assert.equal(result.status, "CLAIMED");
    assert.equal(result.item?.id, "safe-overflow");
  });

  it("treats CLAIMED through MERGE_READY as active conflicts but not MERGED or BLOCKED_HUMAN", () => {
    const activeStates = ["CLAIMED", "IMPLEMENTING", "VALIDATING", "CI", "AUDIT", "MERGE_READY"] as const;
    for (const [index, state] of activeStates.entries()) {
      const queue = createNusaDevelopmentQueue([
        work({ id: `active-${state}`, state, canonicalOwner: "other", touchedFiles: ["same.ts"] }),
        work({ id: `candidate-${state}`, priority: "P0", touchedFiles: ["same.ts"] }),
      ]);
      const result = claimNextNusaDevelopmentWork(queue, {
        owner: "development",
        requestId: `active-${index}`,
        expectedRevision: 0,
        now: T0,
        leaseMs: 60_000,
        allocationPolicy: { maximumActiveWorkPerOwner: 2, preventTouchedFileConflicts: true },
      });
      assert.equal(result.status, "NO_READY_WORK", state);
    }

    for (const state of ["MERGED", "BLOCKED_HUMAN"] as const) {
      const queue = createNusaDevelopmentQueue([
        work({ id: `inactive-${state}`, state, touchedFiles: ["same.ts"] }),
        work({ id: `candidate-${state}`, priority: "P0", touchedFiles: ["same.ts"] }),
      ]);
      const result = claimNextNusaDevelopmentWork(queue, {
        owner: "development",
        requestId: `inactive-${state}`,
        expectedRevision: 0,
        now: T0,
        leaseMs: 60_000,
        allocationPolicy: { maximumActiveWorkPerOwner: 2, preventTouchedFileConflicts: true },
      });
      assert.equal(result.status, "CLAIMED", state);
    }
  });

  it("enforces per-owner WIP without blocking independent owners", () => {
    const queue = createNusaDevelopmentQueue([
      work({ id: "owned", state: "CI", canonicalOwner: "development" }),
      work({ id: "ready", priority: "P0" }),
    ]);
    const blocked = claimNextNusaDevelopmentWork(queue, {
      owner: "development",
      requestId: "wip-blocked",
      expectedRevision: 0,
      now: T0,
      leaseMs: 60_000,
      allocationPolicy: { maximumActiveWorkPerOwner: 1, preventTouchedFileConflicts: true },
    });
    assert.equal(blocked.status, "WIP_LIMIT_REACHED");
    assert.equal(blocked.queue, queue);

    const other = claimNextNusaDevelopmentWork(queue, {
      owner: "qa",
      requestId: "wip-other",
      expectedRevision: 0,
      now: T0,
      leaseMs: 60_000,
      allocationPolicy: { maximumActiveWorkPerOwner: 1, preventTouchedFileConflicts: true },
    });
    assert.equal(other.status, "CLAIMED");
    assert.equal(other.item?.id, "ready");
  });

  it("preserves legacy deterministic claiming when no allocation policy is supplied", () => {
    const queue = createNusaDevelopmentQueue([
      work({ id: "active", state: "CI", canonicalOwner: "development", touchedFiles: ["same.ts"] }),
      work({ id: "ready", priority: "P0", touchedFiles: ["same.ts"] }),
    ]);
    const result = claimNextNusaDevelopmentWork(queue, {
      owner: "development",
      requestId: "legacy",
      expectedRevision: 0,
      now: T0,
      leaseMs: 60_000,
    });
    assert.equal(result.status, "CLAIMED");
    assert.equal(result.item?.id, "ready");
  });

  it("claims a bounded conflict-aware portfolio through the canonical single-item path", () => {
    const queue = createNusaDevelopmentQueue([
      work({ id: "p0-shared", priority: "P0", touchedFiles: ["shared.ts"] }),
      work({ id: "p0-independent", priority: "P0", touchedFiles: ["independent.ts"] }),
      work({ id: "p1-shared", priority: "P1", touchedFiles: ["shared.ts"] }),
    ]);
    const result = claimNusaDevelopmentWorkPortfolio(queue, {
      owner: "development",
      requestId: "portfolio-run",
      expectedRevision: 0,
      now: T0,
      leaseMs: 60_000,
      maximumItems: 3,
      allocationPolicy: { maximumActiveWorkPerOwner: 3, preventTouchedFileConflicts: true },
    });
    assert.equal(result.status, "PARTIAL");
    assert.deepEqual(result.items.map((item) => item.id), ["p0-independent", "p0-shared"]);
    assert.equal(result.claimedCount, 2);
    assert.equal(result.replayedCount, 0);
    assert.equal(result.stopReason, "NO_READY_WORK");
    assert.equal(result.queue.revision, 2);
    assert.equal(result.queue.items.find((item) => item.id === "p1-shared")?.state, "READY");

    const replay = claimNusaDevelopmentWorkPortfolio(result.queue, {
      owner: "development",
      requestId: "portfolio-run",
      expectedRevision: 0,
      now: T0,
      leaseMs: 60_000,
      maximumItems: 2,
      allocationPolicy: { maximumActiveWorkPerOwner: 3, preventTouchedFileConflicts: true },
    });
    assert.equal(replay.status, "IDEMPOTENT_REPLAY");
    assert.equal(replay.claimedCount, 0);
    assert.equal(replay.replayedCount, 2);
    assert.equal(replay.queue, result.queue);
  });

  it("stops portfolio allocation at the owner WIP limit and rejects stale revisions", () => {
    const queue = createNusaDevelopmentQueue([
      work({ id: "already-active", state: "CI", canonicalOwner: "development" }),
      work({ id: "ready-a", priority: "P0" }),
      work({ id: "ready-b", priority: "P1" }),
    ]);
    const limited = claimNusaDevelopmentWorkPortfolio(queue, {
      owner: "development",
      requestId: "limited-run",
      expectedRevision: 0,
      now: T0,
      leaseMs: 60_000,
      maximumItems: 4,
      allocationPolicy: { maximumActiveWorkPerOwner: 2, preventTouchedFileConflicts: true },
    });
    assert.equal(limited.status, "PARTIAL");
    assert.equal(limited.claimedCount, 1);
    assert.equal(limited.stopReason, "WIP_LIMIT_REACHED");

    const stale = claimNusaDevelopmentWorkPortfolio(queue, {
      owner: "development",
      requestId: "stale-run",
      expectedRevision: 1,
      now: T0,
      leaseMs: 60_000,
      maximumItems: 1,
    });
    assert.equal(stale.status, "REVISION_CONFLICT");
    assert.equal(stale.items.length, 0);
  });

  it("rejects an unbounded or invalid portfolio request before claiming", () => {
    const queue = createNusaDevelopmentQueue([work({ id: "ready" })]);
    assert.throws(() => claimNusaDevelopmentWorkPortfolio(queue, {
      owner: "development",
      requestId: "bad-max",
      expectedRevision: 0,
      now: T0,
      leaseMs: 60_000,
      maximumItems: 0,
    }), /CLAIM_PORTFOLIO_MAXIMUM_ITEMS_INVALID/);
  });

  it("fails closed on invalid WIP allocation policy", () => {
    const queue = createNusaDevelopmentQueue([work({ id: "ready" })]);
    for (const maximumActiveWorkPerOwner of [0, -1, 1.5, Number.MAX_VALUE]) {
      assert.throws(() => claimNextNusaDevelopmentWork(queue, {
        owner: "development",
        requestId: `bad-wip-${maximumActiveWorkPerOwner}`,
        expectedRevision: 0,
        now: T0,
        leaseMs: 60_000,
        allocationPolicy: { maximumActiveWorkPerOwner, preventTouchedFileConflicts: true },
      }), /ALLOCATION_WIP_LIMIT_INVALID/);
    }
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

  it("requeues only expired claims with matching execution evidence", () => {
    const claimed = claimNextNusaDevelopmentWork(
      createNusaDevelopmentQueue([work({ id: "evidence-stale" })]),
      { owner: "development", requestId: "evidence-run", expectedRevision: 0, now: T0, leaseMs: 1_000 },
    );
    assert.equal(claimed.status, "CLAIMED");
    const blocked = recoverStaleNusaDevelopmentClaimWithEvidence(claimed.queue, T0 + 1_000, {
      "evidence-stale": { claimRequestId: "evidence-run", sourceSha: "abc", activeCi: true, activePr: false, checkpointAvailable: false, executionStatus: "STOPPED" },
    });
    assert.equal(blocked.queue, claimed.queue);
    assert.equal(blocked.outcomes["evidence-stale"], "CLAIM_BLOCKED_HUMAN");
    const requeued = recoverStaleNusaDevelopmentClaimWithEvidence(claimed.queue, T0 + 1_000, {
      "evidence-stale": { claimRequestId: "evidence-run", sourceSha: "abc", activeCi: false, activePr: false, checkpointAvailable: false, executionStatus: "STOPPED" },
    });
    assert.equal(requeued.queue.items[0]?.state, "READY");
    assert.equal(requeued.outcomes["evidence-stale"], "CLAIM_STALE_REQUEUE");
    const mismatch = recoverStaleNusaDevelopmentClaimWithEvidence(claimed.queue, T0 + 1_000, {
      "evidence-stale": { claimRequestId: "other-run", sourceSha: "abc", activeCi: false, activePr: false, checkpointAvailable: false, executionStatus: "STOPPED" },
    });
    assert.equal(mismatch.queue, claimed.queue);
    assert.equal(mismatch.outcomes["evidence-stale"], "CLAIM_FAIL_CLOSED");
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
