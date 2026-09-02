import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isUniverseMembershipConsistent, resolveUniverseMembership, type UniverseMembershipEvent } from "./aiEvaluationUniverseMembership";

const events: readonly UniverseMembershipEvent[] = [
  { eventId: "1", symbol: "AAA", type: "ADDED", effectiveAt: 1000 },
  { eventId: "2", symbol: "AAA", type: "DELISTED", effectiveAt: 5000 },
  { eventId: "3", symbol: "BBB", type: "ADDED", effectiveAt: 2000 },
  { eventId: "4", symbol: "CCC", type: "ADDED", effectiveAt: 1000 },
  { eventId: "5", symbol: "CCC", type: "REMOVED", effectiveAt: 3000 },
  { eventId: "6", symbol: "CCC", type: "ADDED", effectiveAt: 4000 },
];

describe("point-in-time universe membership", () => {
  it("resolves membership and exits at prediction time", () => {
    assert.deepEqual(resolveUniverseMembership("AAA", 2000, events), { member: true });
    assert.deepEqual(resolveUniverseMembership("AAA", 5000, events), { member: false, reason: "REMOVED_BEFORE_EFFECTIVE_TIME" });
    assert.deepEqual(resolveUniverseMembership("BBB", 1500, events), { member: false, reason: "NEVER_ADDED_BY_EFFECTIVE_TIME" });
  });
  it("handles re-add after removal", () => {
    assert.equal(resolveUniverseMembership("CCC", 3500, events).member, false);
    assert.deepEqual(resolveUniverseMembership("CCC", 4500, events), { member: true });
  });
  it("binds a symbol change to an explicit paired addition", () => {
    const rename: readonly UniverseMembershipEvent[] = [
      { eventId: "a1", symbol: "AAA", type: "ADDED", effectiveAt: 1000 },
      { eventId: "a2", symbol: "AAA", type: "SYMBOL_CHANGED", effectiveAt: 2000, renamedTo: "BBB" },
      { eventId: "b1", symbol: "BBB", type: "ADDED", effectiveAt: 2000 },
    ];
    assert.deepEqual(resolveUniverseMembership("AAA", 1999, rename), { member: true });
    assert.deepEqual(resolveUniverseMembership("AAA", 2000, rename), { member: false, reason: "REMOVED_BEFORE_EFFECTIVE_TIME" });
    assert.deepEqual(resolveUniverseMembership("BBB", 1999, rename), { member: false, reason: "NEVER_ADDED_BY_EFFECTIVE_TIME" });
    assert.deepEqual(resolveUniverseMembership("BBB", 2000, rename), { member: true });
  });
  it("fails closed on unpaired, wrong-time, and self-renaming histories", () => {
    const unpaired: readonly UniverseMembershipEvent[] = [
      { eventId: "a1", symbol: "AAA", type: "ADDED", effectiveAt: 1000 },
      { eventId: "a2", symbol: "AAA", type: "SYMBOL_CHANGED", effectiveAt: 2000, renamedTo: "BBB" },
    ];
    const wrongTime: readonly UniverseMembershipEvent[] = [
      ...unpaired,
      { eventId: "b1", symbol: "BBB", type: "ADDED", effectiveAt: 2001 },
    ];
    const selfRename: readonly UniverseMembershipEvent[] = [
      { eventId: "a1", symbol: "AAA", type: "ADDED", effectiveAt: 1000 },
      { eventId: "a2", symbol: "AAA", type: "SYMBOL_CHANGED", effectiveAt: 2000, renamedTo: "AAA" },
    ];
    for (const history of [unpaired, wrongTime, selfRename]) {
      assert.deepEqual(resolveUniverseMembership("AAA", 2000, history), { member: false, reason: "INVALID_EVENT_HISTORY" });
    }
  });
  it("fails closed on invalid evidence", () => {
    assert.deepEqual(resolveUniverseMembership("AAA", Number.NaN, events), { member: false, reason: "INVALID_EFFECTIVE_TIME" });
    assert.deepEqual(resolveUniverseMembership("AAA", 2000, []), { member: false, reason: "INVALID_EVENT_HISTORY" });
    const duplicate: readonly UniverseMembershipEvent[] = [
      { eventId: "d", symbol: "AAA", type: "ADDED", effectiveAt: 1000 },
      { eventId: "d", symbol: "AAA", type: "DELISTED", effectiveAt: 2000 },
    ];
    assert.deepEqual(resolveUniverseMembership("AAA", 2000, duplicate), { member: false, reason: "INVALID_EVENT_HISTORY" });
    const ambiguous: readonly UniverseMembershipEvent[] = [
      { eventId: "a", symbol: "AAA", type: "ADDED", effectiveAt: 1000 },
      { eventId: "b", symbol: "AAA", type: "DELISTED", effectiveAt: 1000 },
    ];
    assert.deepEqual(resolveUniverseMembership("AAA", 1000, ambiguous), { member: false, reason: "INVALID_EVENT_HISTORY" });
  });
  it("rejects inconsistent cohorts", () => {
    assert.equal(isUniverseMembershipConsistent([{ symbol: "AAA", asOf: 2000 }, { symbol: "BBB", asOf: 2500 }], events), true);
    assert.equal(isUniverseMembershipConsistent([{ symbol: "AAA", asOf: 6000 }], events), false);
    assert.equal(isUniverseMembershipConsistent([], events), false);
  });
});
