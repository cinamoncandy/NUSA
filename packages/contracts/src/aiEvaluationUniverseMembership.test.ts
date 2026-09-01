import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveUniverseMembership, isUniverseMembershipConsistent, type UniverseMembershipEvent } from "./aiEvaluationUniverseMembership";

function events(): readonly UniverseMembershipEvent[] {
  return [
    { eventId: "e1", symbol: "AAA", type: "ADDED", effectiveAt: 1_000 },
    { eventId: "e2", symbol: "AAA", type: "DELISTED", effectiveAt: 5_000 },
    { eventId: "e3", symbol: "BBB", type: "ADDED", effectiveAt: 2_000 },
    { eventId: "e4", symbol: "CCC", type: "ADDED", effectiveAt: 1_000 },
    { eventId: "e5", symbol: "CCC", type: "REMOVED", effectiveAt: 3_000 },
    { eventId: "e6", symbol: "CCC", type: "ADDED", effectiveAt: 4_000 },
  ];
}

describe("resolveUniverseMembership", () => {
  it("resolves point-in-time membership and exits", () => {
    assert.deepEqual(resolveUniverseMembership("AAA", 2_000, events()), { member: true });
    assert.deepEqual(resolveUniverseMembership("BBB", 1_500, events()), { member: false, reason: "NEVER_ADDED_BY_EFFECTIVE_TIME" });
    assert.deepEqual(resolveUniverseMembership("AAA", 5_000, events()), { member: false, reason: "REMOVED_BEFORE_EFFECTIVE_TIME" });
    assert.deepEqual(resolveUniverseMembership("ZZZ", 9_000, events()), { member: false, reason: "NEVER_ADDED_BY_EFFECTIVE_TIME" });
  });
  it("handles re-add after removal", () => {
    assert.deepEqual(resolveUniverseMembership("CCC", 2_500, events()), { member: true });
    assert.deepEqual(resolveUniverseMembership("CCC", 3_500, events()), { member: false, reason: "REMOVED_BEFORE_EFFECTIVE_TIME" });
    assert.deepEqual(resolveUniverseMembership("CCC", 4_500, events()), { member: true });
  });
  it("fails closed on invalid timestamps and malformed histories", () => {
    assert.deepEqual(resolveUniverseMembership("AAA", Number.NaN, events()), { member: false, reason: "INVALID_EFFECTIVE_TIME" });
    assert.deepEqual(resolveUniverseMembership("AAA", -1, events()), { member: false, reason: "INVALID_EFFECTIVE_TIME" });
    assert.deepEqual(resolveUniverseMembership("AAA", 2_000, []), { member: false, reason: "INVALID_EVENT_HISTORY" });
    const malformed = [{ eventId: "e1", symbol: "AAA", type: "SYMBOL_CHANGED", effectiveAt: 2_000 }] as readonly UniverseMembershipEvent[];
    assert.deepEqual(resolveUniverseMembership("AAA", 3_000, malformed), { member: false, reason: "INVALID_EVENT_HISTORY" });
    const duplicate: readonly UniverseMembershipEvent[] = [
      { eventId: "e1", symbol: "AAA", type: "ADDED", effectiveAt: 1_000 },
      { eventId: "e1", symbol: "AAA", type: "DELISTED", effectiveAt: 2_000 },
    ];
    assert.deepEqual(resolveUniverseMembership("AAA", 3_000, duplicate), { member: false, reason: "INVALID_EVENT_HISTORY" });
  });
  it("fails closed on ambiguous same-symbol events at the same effective time regardless of input order", () => {
    const addThenExit: readonly UniverseMembershipEvent[] = [
      { eventId: "e1", symbol: "AAA", type: "ADDED", effectiveAt: 1_000 },
      { eventId: "e2", symbol: "AAA", type: "DELISTED", effectiveAt: 1_000 },
    ];
    const exitThenAdd = [...addThenExit].reverse();
    assert.deepEqual(resolveUniverseMembership("AAA", 1_000, addThenExit), { member: false, reason: "INVALID_EVENT_HISTORY" });
    assert.deepEqual(resolveUniverseMembership("AAA", 1_000, exitThenAdd), { member: false, reason: "INVALID_EVENT_HISTORY" });
  });
});

describe("isUniverseMembershipConsistent", () => {
  it("requires every historical claim to be a member", () => {
    assert.equal(isUniverseMembershipConsistent([{ symbol: "AAA", asOf: 2_000 }, { symbol: "BBB", asOf: 2_500 }], events()), true);
    assert.equal(isUniverseMembershipConsistent([{ symbol: "AAA", asOf: 2_000 }, { symbol: "BBB", asOf: 500 }], events()), false);
    assert.equal(isUniverseMembershipConsistent([{ symbol: "AAA", asOf: 6_000 }], events()), false);
    assert.equal(isUniverseMembershipConsistent([], events()), false);
  });
});
