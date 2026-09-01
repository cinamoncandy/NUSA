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
    { eventId: "e6", symbol: "CCC", type: "ADDED", effectiveAt: 4_000 }, // re-added after removal
  ];
}

describe("resolveUniverseMembership", () => {
  it("is a member between ADDED and its exit event", () => {
    assert.deepEqual(resolveUniverseMembership("AAA", 2_000, events()), { member: true });
  });

  it("is not a member before its ADDED event (would-be survivorship bias if assumed a member)", () => {
    assert.deepEqual(resolveUniverseMembership("BBB", 1_500, events()), { member: false, reason: "NEVER_ADDED_BY_EFFECTIVE_TIME" });
  });

  it("is not a member at or after a DELISTED event", () => {
    assert.deepEqual(resolveUniverseMembership("AAA", 5_000, events()), { member: false, reason: "REMOVED_BEFORE_EFFECTIVE_TIME" });
    assert.deepEqual(resolveUniverseMembership("AAA", 9_000, events()), { member: false, reason: "REMOVED_BEFORE_EFFECTIVE_TIME" });
  });

  it("has never been a member of an entirely unknown symbol", () => {
    assert.deepEqual(resolveUniverseMembership("ZZZ", 9_000, events()), { member: false, reason: "NEVER_ADDED_BY_EFFECTIVE_TIME" });
  });

  it("handles a re-add after a prior removal correctly", () => {
    assert.deepEqual(resolveUniverseMembership("CCC", 2_500, events()), { member: true }); // between first add and removal
    assert.deepEqual(resolveUniverseMembership("CCC", 3_500, events()), { member: false, reason: "REMOVED_BEFORE_EFFECTIVE_TIME" }); // after removal, before re-add
    assert.deepEqual(resolveUniverseMembership("CCC", 4_500, events()), { member: true }); // after re-add
  });

  it("fails closed on an invalid asOf", () => {
    assert.deepEqual(resolveUniverseMembership("AAA", Number.NaN, events()), { member: false, reason: "INVALID_EFFECTIVE_TIME" });
    assert.deepEqual(resolveUniverseMembership("AAA", -1, events()), { member: false, reason: "INVALID_EFFECTIVE_TIME" });
  });

  it("fails closed on an empty event history", () => {
    assert.deepEqual(resolveUniverseMembership("AAA", 2_000, []), { member: false, reason: "INVALID_EVENT_HISTORY" });
  });

  it("fails closed on a malformed event (SYMBOL_CHANGED missing renamedTo)", () => {
    const malformed: readonly UniverseMembershipEvent[] = [
      { eventId: "e1", symbol: "AAA", type: "ADDED", effectiveAt: 1_000 },
      { eventId: "e2", symbol: "AAA", type: "SYMBOL_CHANGED", effectiveAt: 2_000 },
    ];
    assert.deepEqual(resolveUniverseMembership("AAA", 3_000, malformed), { member: false, reason: "INVALID_EVENT_HISTORY" });
  });

  it("fails closed on a duplicate eventId", () => {
    const duplicate: readonly UniverseMembershipEvent[] = [
      { eventId: "e1", symbol: "AAA", type: "ADDED", effectiveAt: 1_000 },
      { eventId: "e1", symbol: "AAA", type: "DELISTED", effectiveAt: 2_000 },
    ];
    assert.deepEqual(resolveUniverseMembership("AAA", 3_000, duplicate), { member: false, reason: "INVALID_EVENT_HISTORY" });
  });
});

describe("isUniverseMembershipConsistent", () => {
  it("is true when every claim resolves to actual membership", () => {
    const claims = [{ symbol: "AAA", asOf: 2_000 }, { symbol: "BBB", asOf: 2_500 }];
    assert.equal(isUniverseMembershipConsistent(claims, events()), true);
  });

  it("is false when any claim references a symbol not yet added at that time", () => {
    const claims = [{ symbol: "AAA", asOf: 2_000 }, { symbol: "BBB", asOf: 500 }];
    assert.equal(isUniverseMembershipConsistent(claims, events()), false);
  });

  it("is false when any claim references a delisted/removed symbol at that time (survivorship bias)", () => {
    const claims = [{ symbol: "AAA", asOf: 6_000 }];
    assert.equal(isUniverseMembershipConsistent(claims, events()), false);
  });

  it("is false for an empty claim set rather than vacuously true", () => {
    assert.equal(isUniverseMembershipConsistent([], events()), false);
  });
});
