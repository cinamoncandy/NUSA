import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAppendOnlySelectionHistory, labelSelectionCandidate, type SelectionHistoryEntry } from "./aiEvaluationConfirmatoryLabeling";

function entry(overrides: Partial<SelectionHistoryEntry> = {}): SelectionHistoryEntry {
  return { entryId: "e1", evaluationFamilyId: "family-1", candidateKey: "provider=openai;model=v3", declaredConfirmatory: true, declaredAt: 1_000, ...overrides };
}

describe("isAppendOnlySelectionHistory", () => {
  it("is true when a new entry is appended and prior entries are unchanged", () => {
    const e2 = entry({ entryId: "e2", declaredConfirmatory: false });
    assert.equal(isAppendOnlySelectionHistory([entry()], [entry(), e2]), true);
  });

  it("is true for identical histories", () => {
    assert.equal(isAppendOnlySelectionHistory([entry()], [entry()]), true);
  });

  it("is false when a prior entry is dropped", () => {
    const e2 = entry({ entryId: "e2" });
    assert.equal(isAppendOnlySelectionHistory([entry(), e2], [e2]), false);
  });

  it("is false when a prior entry's declaredConfirmatory flag is edited after the fact", () => {
    const edited = entry({ declaredConfirmatory: false });
    assert.equal(isAppendOnlySelectionHistory([entry()], [edited]), false);
  });

  it("is false when a prior entry's declaredAt is edited (post-hoc backdating)", () => {
    const backdated = entry({ declaredAt: 500 });
    assert.equal(isAppendOnlySelectionHistory([entry()], [backdated]), false);
  });
});

describe("labelSelectionCandidate", () => {
  it("labels a pre-declared, sole-confirmatory candidate as CONFIRMATORY", () => {
    const history = [entry({ entryId: "e1", declaredConfirmatory: true, declaredAt: 500 })];
    assert.deepEqual(labelSelectionCandidate("e1", history, 2_000), { resolved: true, label: "CONFIRMATORY" });
  });

  it("labels a candidate not declared confirmatory as EXPLORATORY", () => {
    const history = [entry({ entryId: "e1", declaredConfirmatory: false, declaredAt: 500 })];
    assert.deepEqual(labelSelectionCandidate("e1", history, 2_000), { resolved: true, label: "EXPLORATORY" });
  });

  it("labels a candidate declared confirmatory at or after outcomes were observed as EXPLORATORY", () => {
    const history = [entry({ entryId: "e1", declaredConfirmatory: true, declaredAt: 2_000 })];
    assert.deepEqual(labelSelectionCandidate("e1", history, 2_000), { resolved: true, label: "EXPLORATORY" });
  });

  it("downgrades BOTH candidates to EXPLORATORY when two are pre-declared confirmatory in the same family (contradiction)", () => {
    const history = [
      entry({ entryId: "e1", declaredConfirmatory: true, declaredAt: 500 }),
      entry({ entryId: "e2", candidateKey: "provider=anthropic;model=v5", declaredConfirmatory: true, declaredAt: 600 }),
    ];
    assert.deepEqual(labelSelectionCandidate("e1", history, 2_000), { resolved: true, label: "EXPLORATORY" });
    assert.deepEqual(labelSelectionCandidate("e2", history, 2_000), { resolved: true, label: "EXPLORATORY" });
  });

  it("does not let a different family's pre-declared-confirmatory candidate affect this family's labeling", () => {
    const history = [
      entry({ entryId: "e1", evaluationFamilyId: "family-1", declaredConfirmatory: true, declaredAt: 500 }),
      entry({ entryId: "e2", evaluationFamilyId: "family-2", declaredConfirmatory: true, declaredAt: 600 }),
    ];
    assert.deepEqual(labelSelectionCandidate("e1", history, 2_000), { resolved: true, label: "CONFIRMATORY" });
  });

  it("fails closed when the candidate is not in the history", () => {
    assert.deepEqual(labelSelectionCandidate("missing", [entry()], 2_000), { resolved: false, reason: "CANDIDATE_NOT_IN_HISTORY" });
  });

  it("fails closed on an invalid earliestOutcomeObservedAt", () => {
    assert.deepEqual(labelSelectionCandidate("e1", [entry()], Number.NaN), { resolved: false, reason: "MALFORMED_HISTORY" });
  });

  it("fails closed on a malformed history entry", () => {
    const malformed = [entry({ entryId: "" })];
    assert.deepEqual(labelSelectionCandidate("e1", malformed, 2_000), { resolved: false, reason: "MALFORMED_HISTORY" });
  });
});
