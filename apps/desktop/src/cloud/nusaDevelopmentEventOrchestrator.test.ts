import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  claimNextNusaDevelopmentWork,
  createNusaDevelopmentQueue,
  type NusaDevelopmentWorkItem,
} from "./nusaDevelopmentControlPlane";
import {
  applyNusaDevelopmentEvent,
  createNusaDevelopmentEventOrchestratorState,
  replayNusaDevelopmentEvents,
} from "./nusaDevelopmentEventOrchestrator";

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

function claimedState() {
  const claimed = claimNextNusaDevelopmentWork(
    createNusaDevelopmentQueue([work({ id: "w1", priority: "P0" })]),
    { owner: "development", requestId: "claim-1", expectedRevision: 0, now: T0, leaseMs: 60_000 },
  );
  assert.equal(claimed.status, "CLAIMED");
  return createNusaDevelopmentEventOrchestratorState(claimed.queue);
}

describe("NUSA development event orchestrator", () => {
  it("advances the canonical work item through implementation, validation, CI, and merge", () => {
    let state = claimedState();
    const events = [
      ["IMPLEMENTATION_STARTED", "IMPLEMENTING", "implement"],
      ["VALIDATION_STARTED", "VALIDATING", "validate"],
      ["CI_STARTED", "CI", "await-exact-head-ci"],
      ["CI_SUCCEEDED", "MERGE_READY", "merge"],
      ["PR_MERGED", "MERGED", "done"],
    ] as const;

    for (let index = 0; index < events.length; index += 1) {
      const [type, expectedState, expectedAction] = events[index]!;
      const result = applyNusaDevelopmentEvent(state, {
        eventId: `event-${index}`,
        type,
        workId: "w1",
        expectedRevision: state.queue.revision,
        occurredAt: T0 + index + 1,
      });
      assert.equal(result.status, "APPLIED");
      assert.equal(result.item?.state, expectedState);
      assert.equal(result.item?.nextAction, expectedAction);
      state = result.state;
    }

    assert.equal(state.queue.items[0]?.claim, null);
    assert.equal(state.processedEventIds.length, 5);
  });

  it("makes duplicate delivery replay-safe without incrementing revision", () => {
    const state = claimedState();
    const event = {
      eventId: "same-event",
      type: "IMPLEMENTATION_STARTED" as const,
      workId: "w1",
      expectedRevision: state.queue.revision,
      occurredAt: T0 + 1,
    };
    const first = applyNusaDevelopmentEvent(state, event);
    assert.equal(first.status, "APPLIED");

    const replay = applyNusaDevelopmentEvent(first.state, event);
    assert.equal(replay.status, "IDEMPOTENT_REPLAY");
    assert.equal(replay.state, first.state);
    assert.equal(replay.state.queue.revision, first.state.queue.revision);
  });

  it("rejects an event id reused with a different payload", () => {
    const state = claimedState();
    const event = {
      eventId: "same-event",
      type: "IMPLEMENTATION_STARTED" as const,
      workId: "w1",
      expectedRevision: state.queue.revision,
      occurredAt: T0 + 1,
    };
    const first = applyNusaDevelopmentEvent(state, event);
    assert.equal(first.status, "APPLIED");

    const conflict = applyNusaDevelopmentEvent(first.state, {
      ...event,
      type: "HUMAN_BLOCKED",
      reason: "different-delivery",
    });
    assert.equal(conflict.status, "EVENT_ID_CONFLICT");
    assert.equal(conflict.state, first.state);
    assert.equal(conflict.item?.state, "IMPLEMENTING");
    assert.equal(conflict.state.queue.revision, first.state.queue.revision);
  });

  it("fails closed on stale revisions and impossible event ordering", () => {
    const state = claimedState();
    const stale = applyNusaDevelopmentEvent(state, {
      eventId: "stale",
      type: "IMPLEMENTATION_STARTED",
      workId: "w1",
      expectedRevision: state.queue.revision - 1,
      occurredAt: T0 + 1,
    });
    assert.equal(stale.status, "REVISION_CONFLICT");
    assert.equal(stale.state, state);

    const outOfOrder = applyNusaDevelopmentEvent(state, {
      eventId: "out-of-order",
      type: "CI_SUCCEEDED",
      workId: "w1",
      expectedRevision: state.queue.revision,
      occurredAt: T0 + 2,
    });
    assert.equal(outOfOrder.status, "INVALID_TRANSITION");
    assert.equal(outOfOrder.item?.state, "CLAIMED");
  });

  it("routes CI failure back to implementation without pretending success", () => {
    let state = claimedState();
    for (const [index, type] of ["IMPLEMENTATION_STARTED", "VALIDATION_STARTED", "CI_STARTED"].entries()) {
      const result = applyNusaDevelopmentEvent(state, {
        eventId: `prepare-${index}`,
        type: type as "IMPLEMENTATION_STARTED" | "VALIDATION_STARTED" | "CI_STARTED",
        workId: "w1",
        expectedRevision: state.queue.revision,
        occurredAt: T0 + index + 1,
      });
      assert.equal(result.status, "APPLIED");
      state = result.state;
    }

    const failed = applyNusaDevelopmentEvent(state, {
      eventId: "ci-failed",
      type: "CI_FAILED",
      workId: "w1",
      expectedRevision: state.queue.revision,
      occurredAt: T0 + 10,
      reason: "coverage-core-0",
    });
    assert.equal(failed.status, "APPLIED");
    assert.equal(failed.item?.state, "IMPLEMENTING");
    assert.equal(failed.item?.nextAction, "repair-ci-failure");
  });

  it("supports HUMAN_BLOCKED as an explicit terminal wait state without live authority changes", () => {
    const state = claimedState();
    const blocked = applyNusaDevelopmentEvent(state, {
      eventId: "human-block",
      type: "HUMAN_BLOCKED",
      workId: "w1",
      expectedRevision: state.queue.revision,
      occurredAt: T0 + 1,
      reason: "physical-device-evidence",
    });
    assert.equal(blocked.status, "APPLIED");
    assert.equal(blocked.item?.state, "BLOCKED_HUMAN");
    assert.equal(blocked.item?.nextAction, "human-blocked:physical-device-evidence");
    assert.equal(blocked.item?.claim, null);
  });

  it("canonicalizes processed event ids regardless of delivery order", () => {
    const queue = createNusaDevelopmentQueue([work({ id: "w1" })]);
    const events = [
      { eventId: "z-event", type: "IMPLEMENTATION_STARTED" as const, workId: "w1", expectedRevision: 1, occurredAt: T0 + 2 },
      { eventId: "a-event", type: "VALIDATION_STARTED" as const, workId: "w1", expectedRevision: 2, occurredAt: T0 + 3 },
    ];
    assert.deepEqual(
      createNusaDevelopmentEventOrchestratorState(queue, events).processedEventIds,
      ["a-event", "z-event"],
    );
  });

  it("rejects unsafe event identity, revision, and timestamp values", () => {
    const state = claimedState();
    for (const override of [
      { eventId: "", expectedRevision: state.queue.revision },
      { eventId: "event with spaces", expectedRevision: state.queue.revision },
      { eventId: "valid", expectedRevision: -1 },
      { eventId: "valid", expectedRevision: state.queue.revision, occurredAt: 1.5 },
    ]) {
      assert.throws(() => applyNusaDevelopmentEvent(state, {
        eventId: override.eventId,
        type: "IMPLEMENTATION_STARTED",
        workId: "w1",
        expectedRevision: override.expectedRevision,
        occurredAt: override.occurredAt ?? T0 + 1,
      }), /EVENT_(ID_INVALID|EXPECTED_REVISION_INVALID|OCCURRED_AT_INVALID)/);
    }
  });

  it("replays a canonical history deterministically and rejects chronology regressions", () => {
    const initial = createNusaDevelopmentQueue([work({ id: "w1", state: "CLAIMED", canonicalOwner: "development", claim: { owner: "development", requestId: "claim-1", claimedAt: T0, leaseExpiresAt: T0 + 60_000 } })]);
    const events = [
      { eventId: "event-1", type: "IMPLEMENTATION_STARTED" as const, workId: "w1", expectedRevision: 0, occurredAt: T0 + 1 },
      { eventId: "event-2", type: "VALIDATION_STARTED" as const, workId: "w1", expectedRevision: 1, occurredAt: T0 + 2 },
      { eventId: "event-3", type: "CI_STARTED" as const, workId: "w1", expectedRevision: 2, occurredAt: T0 + 3 },
    ];
    const first = replayNusaDevelopmentEvents(initial, events);
    const second = replayNusaDevelopmentEvents(initial, [...events]);
    assert.deepEqual(first, second);
    assert.equal(first.queue.revision, 3);
    assert.throws(() => replayNusaDevelopmentEvents(initial, [events[1]!, events[0]!]), /EVENT_REPLAY_CHRONOLOGY_INVALID|EVENT_REPLAY_REVISION_CONFLICT/);
  });
});
