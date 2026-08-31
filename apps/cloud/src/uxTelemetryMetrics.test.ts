import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeUxMetrics } from "./uxTelemetryMetrics";
import type { UxTelemetryEvent } from "../../../packages/contracts/src/uxTelemetryEvent";

function event(overrides: Partial<UxTelemetryEvent>): UxTelemetryEvent {
  return {
    schemaVersion: 1,
    eventId: `evt-${Math.random()}`,
    kind: "SCREEN_VIEW",
    sessionId: "session-1",
    ownerPrincipalId: "owner-1",
    screenId: "HOME",
    occurredAtMs: 0,
    ...overrides,
  };
}

describe("ux telemetry metrics", () => {
  it("returns nulls and zero counts for an empty batch", () => {
    const summary = summarizeUxMetrics([]);
    assert.equal(summary.sampleTaskCount, 0);
    assert.equal(summary.sampleSessionCount, 0);
    assert.equal(summary.taskCompletionTimeMsMedian, null);
    assert.equal(summary.errorRate, null);
  });

  it("computes task completion time and taps for one completed task", () => {
    const events = [
      event({ kind: "TASK_STARTED", taskId: "T1", occurredAtMs: 0 }),
      event({ kind: "TAP", actionId: "APPROVE", taskId: "T1", occurredAtMs: 500 }),
      event({ kind: "TAP", actionId: "CONFIRM", taskId: "T1", occurredAtMs: 900 }),
      event({ kind: "TASK_COMPLETED", taskId: "T1", occurredAtMs: 1_000 }),
    ];
    const summary = summarizeUxMetrics(events);
    assert.equal(summary.sampleTaskCount, 1);
    assert.equal(summary.taskCompletionTimeMsMedian, 1_000);
    assert.equal(summary.taskCompletionTapsMedian, 2);
  });

  it("computes navigation depth max and mean", () => {
    const events = [
      event({ kind: "NAVIGATION_PUSH", navigationDepth: 1, occurredAtMs: 0 }),
      event({ kind: "NAVIGATION_PUSH", navigationDepth: 3, occurredAtMs: 100 }),
    ];
    const summary = summarizeUxMetrics(events);
    assert.equal(summary.navigationDepthMax, 3);
    assert.equal(summary.navigationDepthMean, 2);
  });

  it("computes error rate and recovery rate", () => {
    const events = [
      event({ kind: "ERROR_SHOWN", occurredAtMs: 0 }),
      event({ kind: "ERROR_SHOWN", occurredAtMs: 100 }),
      event({ kind: "ERROR_RECOVERED", occurredAtMs: 200 }),
    ];
    const summary = summarizeUxMetrics(events);
    assert.equal(summary.errorRate, 2 / 3);
    assert.equal(summary.recoveryRate, 1 / 2);
  });

  it("computes approval friction rate", () => {
    const events = [
      event({ kind: "APPROVAL_REQUESTED", occurredAtMs: 0 }),
      event({ kind: "APPROVAL_REQUESTED", occurredAtMs: 100 }),
      event({ kind: "APPROVAL_CANCELLED", occurredAtMs: 150 }),
    ];
    const summary = summarizeUxMetrics(events);
    assert.equal(summary.approvalFrictionRate, 0.5);
  });

  it("computes abandonment rate across started tasks", () => {
    const events = [
      event({ kind: "TASK_STARTED", taskId: "T1", occurredAtMs: 0 }),
      event({ kind: "TASK_ABANDONED", taskId: "T1", occurredAtMs: 100 }),
      event({ kind: "TASK_STARTED", taskId: "T2", occurredAtMs: 200 }),
      event({ kind: "TASK_COMPLETED", taskId: "T2", occurredAtMs: 300 }),
    ];
    const summary = summarizeUxMetrics(events);
    assert.equal(summary.abandonmentRate, 0.5);
  });

  it("computes repeat action rate", () => {
    const events = [
      event({ kind: "TAP", actionId: "A", occurredAtMs: 0 }),
      event({ kind: "TAP", actionId: "A", occurredAtMs: 100 }),
      event({ kind: "REPEAT_ACTION", actionId: "A", occurredAtMs: 100 }),
    ];
    const summary = summarizeUxMetrics(events);
    assert.equal(summary.repeatActionRate, 0.5);
  });

  it("counts distinct sessions in the batch", () => {
    const events = [
      event({ sessionId: "s1", occurredAtMs: 0 }),
      event({ sessionId: "s2", occurredAtMs: 100 }),
      event({ sessionId: "s1", occurredAtMs: 200 }),
    ];
    const summary = summarizeUxMetrics(events);
    assert.equal(summary.sampleSessionCount, 2);
  });
});
