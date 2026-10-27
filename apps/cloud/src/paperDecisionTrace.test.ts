import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DECISION_TRACE_BUCKETS, DECISION_TRACE_BUCKET_MS, PaperDecisionTrace } from "./paperDecisionTrace";

const DAY = 86_400_000;
const WINDOW = Date.UTC(2026, 9, 20, 0, 0, 0); // 09:00 KST

describe("PAPER decision trace (display only)", () => {
  it("buckets decisions and orders by 5 minutes from the window start", () => {
    const trace = new PaperDecisionTrace(DAY, WINDOW + 1_000);
    trace.record("decision", 2, WINDOW + 1_000);
    trace.record("decision", 1, WINDOW + DECISION_TRACE_BUCKET_MS * 3 + 5);
    trace.record("order", 1, WINDOW + DECISION_TRACE_BUCKET_MS * 3 + 9);
    const snap = trace.snapshot(WINDOW + DECISION_TRACE_BUCKET_MS * 4);
    assert.equal(snap.decisions.length, DECISION_TRACE_BUCKETS);
    assert.equal(snap.decisions[0], 2);
    assert.equal(snap.decisions[3], 1);
    assert.equal(snap.orders[3], 1);
    assert.equal(snap.decisions.reduce((a, b) => a + b, 0), 3);
    assert.equal(snap.bucketMs, DECISION_TRACE_BUCKET_MS);
  });

  it("reports since = runtime start inside the first window, so earlier buckets read as unobserved", () => {
    const started = WINDOW + 3 * 3_600_000;
    assert.equal(new PaperDecisionTrace(DAY, started).snapshot(started + 1).since, started);
  });

  it("starts empty at the next 09:00 KST and observes from that start", () => {
    const trace = new PaperDecisionTrace(DAY, WINDOW + 10);
    trace.record("decision", 5, WINDOW + 10);
    trace.record("decision", 1, WINDOW + DAY + 60_000);
    const snap = trace.snapshot(WINDOW + DAY + 120_000);
    assert.equal(snap.since, WINDOW + DAY);
    assert.equal(snap.decisions[0], 1);
    assert.equal(snap.decisions.reduce((a, b) => a + b, 0), 1);
  });

  it("ignores non-positive or non-integer counts and returns frozen copies", () => {
    const trace = new PaperDecisionTrace(DAY, WINDOW);
    for (const bad of [0, -1, 1.5, Number.NaN]) trace.record("decision", bad, WINDOW + 1);
    const snap = trace.snapshot(WINDOW + 2);
    assert.equal(snap.decisions.reduce((a, b) => a + b, 0), 0);
    assert.ok(Object.isFrozen(snap) && Object.isFrozen(snap.decisions));
    assert.throws(() => (snap.decisions as number[]).push(1));
  });
});
