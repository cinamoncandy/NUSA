import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyMultipleTestingCorrection,
  recordTrialLookAndFreeze,
  type TrialCountLedger,
} from "./aiEvaluationMultipleTestingCorrection";

describe("applyMultipleTestingCorrection (Bonferroni)", () => {
  it("divides alpha evenly across all trials", () => {
    const decisions = applyMultipleTestingCorrection(
      [{ trialId: "a", pValue: 0.01 }, { trialId: "b", pValue: 0.03 }, { trialId: "c", pValue: 0.2 }],
      0.05,
      "BONFERRONI",
    );
    for (const decision of decisions) assert.ok(Math.abs(decision.adjustedThreshold - 0.05 / 3) < 1e-12);
    assert.equal(decisions.find((d) => d.trialId === "a")?.significant, true);
    assert.equal(decisions.find((d) => d.trialId === "b")?.significant, false);
    assert.equal(decisions.find((d) => d.trialId === "c")?.significant, false);
  });

  it("becomes stricter as more trials are added (the same p-value can flip from significant to not)", () => {
    const few = applyMultipleTestingCorrection([{ trialId: "a", pValue: 0.02 }], 0.05, "BONFERRONI");
    const many = applyMultipleTestingCorrection(
      Array.from({ length: 10 }, (_unused, index) => ({ trialId: `t${index}`, pValue: index === 0 ? 0.02 : 0.9 })),
      0.05,
      "BONFERRONI",
    );
    assert.equal(few[0].significant, true);
    assert.equal(many[0].significant, false);
  });
});

describe("applyMultipleTestingCorrection (Benjamini-Hochberg)", () => {
  it("is less conservative than Bonferroni for the same trial set (more can be significant)", () => {
    const trials = [
      { trialId: "a", pValue: 0.001 },
      { trialId: "b", pValue: 0.008 },
      { trialId: "c", pValue: 0.039 },
      { trialId: "d", pValue: 0.041 },
      { trialId: "e", pValue: 0.5 },
    ];
    const bonferroni = applyMultipleTestingCorrection(trials, 0.05, "BONFERRONI");
    const bh = applyMultipleTestingCorrection(trials, 0.05, "BENJAMINI_HOCHBERG");
    const bonferroniSignificantCount = bonferroni.filter((d) => d.significant).length;
    const bhSignificantCount = bh.filter((d) => d.significant).length;
    assert.ok(bhSignificantCount >= bonferroniSignificantCount);
  });

  it("marks nothing significant when the largest acceptable rank is never reached", () => {
    const decisions = applyMultipleTestingCorrection(
      [{ trialId: "a", pValue: 0.4 }, { trialId: "b", pValue: 0.6 }, { trialId: "c", pValue: 0.9 }],
      0.05,
      "BENJAMINI_HOCHBERG",
    );
    assert.ok(decisions.every((decision) => decision.significant === false));
  });

  it("preserves input order in the returned decisions regardless of internal ranking", () => {
    const decisions = applyMultipleTestingCorrection(
      [{ trialId: "z", pValue: 0.9 }, { trialId: "a", pValue: 0.001 }],
      0.05,
      "BENJAMINI_HOCHBERG",
    );
    assert.deepEqual(decisions.map((d) => d.trialId), ["z", "a"]);
  });
});

describe("applyMultipleTestingCorrection validation", () => {
  it("rejects an empty trial set", () => {
    assert.throws(() => applyMultipleTestingCorrection([], 0.05, "BONFERRONI"), /MULTIPLE_TESTING_TRIALS_REQUIRED/);
  });

  it("rejects alpha outside (0, 1]", () => {
    assert.throws(() => applyMultipleTestingCorrection([{ trialId: "a", pValue: 0.1 }], 0, "BONFERRONI"));
    assert.throws(() => applyMultipleTestingCorrection([{ trialId: "a", pValue: 0.1 }], 1.5, "BONFERRONI"));
  });

  it("rejects a duplicate trialId", () => {
    assert.throws(
      () => applyMultipleTestingCorrection([{ trialId: "a", pValue: 0.1 }, { trialId: "a", pValue: 0.2 }], 0.05, "BONFERRONI"),
      /MULTIPLE_TESTING_DUPLICATE_TRIAL_ID/,
    );
  });

  it("rejects an out-of-range p-value", () => {
    assert.throws(
      () => applyMultipleTestingCorrection([{ trialId: "a", pValue: 1.5 }], 0.05, "BONFERRONI"),
      /MULTIPLE_TESTING_P_VALUE_INVALID/,
    );
  });
});

describe("recordTrialLookAndFreeze", () => {
  it("accepts the first look for a new family", () => {
    const result = recordTrialLookAndFreeze({}, "family-1", 3);
    assert.equal(result.accepted, true);
    assert.equal(result.frozenTrialCount, 3);
    assert.equal(result.ledger["family-1"], 3);
  });

  it("accepts an increasing count for an existing family", () => {
    const ledger: TrialCountLedger = { "family-1": 3 };
    const result = recordTrialLookAndFreeze(ledger, "family-1", 5);
    assert.equal(result.accepted, true);
    assert.equal(result.ledger["family-1"], 5);
  });

  it("accepts a repeated identical count as a no-op (does not double count)", () => {
    const ledger: TrialCountLedger = { "family-1": 3 };
    const result = recordTrialLookAndFreeze(ledger, "family-1", 3);
    assert.equal(result.accepted, true);
    assert.equal(result.frozenTrialCount, 3);
  });

  it("fails closed on a decreasing count, without mutating the ledger", () => {
    const ledger: TrialCountLedger = { "family-1": 5 };
    const result = recordTrialLookAndFreeze(ledger, "family-1", 3);
    assert.equal(result.accepted, false);
    assert.equal(result.reason, "TRIAL_COUNT_DECREASED");
    assert.equal(result.frozenTrialCount, 5);
    assert.equal(result.ledger["family-1"], 5);
  });

  it("fails closed on a missing familyId", () => {
    const result = recordTrialLookAndFreeze({}, "", 3);
    assert.equal(result.accepted, false);
    assert.equal(result.reason, "FAMILY_ID_REQUIRED");
  });

  it("fails closed on a non-positive or non-integer count", () => {
    assert.equal(recordTrialLookAndFreeze({}, "family-1", 0).accepted, false);
    assert.equal(recordTrialLookAndFreeze({}, "family-1", -1).accepted, false);
    assert.equal(recordTrialLookAndFreeze({}, "family-1", 1.5).accepted, false);
  });

  it("tracks separate families independently", () => {
    const first = recordTrialLookAndFreeze({}, "family-1", 3);
    const second = recordTrialLookAndFreeze(first.ledger, "family-2", 1);
    assert.equal(second.ledger["family-1"], 3);
    assert.equal(second.ledger["family-2"], 1);
  });
});
