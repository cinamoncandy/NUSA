import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LEVEL_10_CRITERIA } from "./moduleLevel10";
import {
  MODULE_QUALIFICATION_RECORDS_V1,
  isLevel10Qualified
} from "./moduleQualificationV1";

describe("module qualification evidence truth", () => {
  it("qualifies only independently evidenced DECISION criteria without claiming Level 10", () => {
    const decision = MODULE_QUALIFICATION_RECORDS_V1.DECISION;
    assert.equal(decision.sourceBlobSha, "904b3e78562ca3f2350133942d2743ac49babd51");
    assert.equal(decision.criteria.CANONICAL_ENTRYPOINT.status, "VERIFIED");

    for (const criterion of ["DETERMINISTIC_IO", "FAIL_CLOSED", "UNIT_TESTED"] as const) {
      const qualification = decision.criteria[criterion];
      assert.equal(qualification.status, "VERIFIED", criterion);
      assert.ok(qualification.evidenceRefs.some((ref) => ref.includes("gitblob:904b3e78562ca3f2350133942d2743ac49babd51")));
      assert.ok(qualification.evidenceRefs.some((ref) => ref.includes("gitblob:be152c0b5d69dd672940ddc934a797043f4d1d6f")));
      assert.ok(qualification.evidenceRefs.some((ref) => ref.includes("run:35429938249:job:105862594690")));
      assert.ok(qualification.evidenceRefs.some((ref) => ref.includes("head:b0c48474e11fc655f7eecd43bc54e6480d2d6de0")));
    }

    for (const criterion of LEVEL_10_CRITERIA) {
      if (["CANONICAL_ENTRYPOINT", "DETERMINISTIC_IO", "FAIL_CLOSED", "UNIT_TESTED"].includes(criterion)) continue;
      assert.equal(decision.criteria[criterion].status, "UNVERIFIED", criterion);
      assert.deepEqual(decision.criteria[criterion].evidenceRefs, []);
    }

    assert.equal(isLevel10Qualified(decision), false);
  });

  it("keeps Strategy canonical ownership and all unevidenced criteria unverified", () => {
    const strategy = MODULE_QUALIFICATION_RECORDS_V1.STRATEGY;
    assert.equal(strategy.criteria.CANONICAL_ENTRYPOINT.status, "UNVERIFIED");
    assert.equal(isLevel10Qualified(strategy), false);
  });

  it("does not accidentally promote any module to Level 10", () => {
    for (const record of Object.values(MODULE_QUALIFICATION_RECORDS_V1)) {
      assert.equal(isLevel10Qualified(record), false, record.stage);
    }
  });
});
