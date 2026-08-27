import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideNusaAdaptiveConcurrency } from "./nusaAdaptiveConcurrency";

describe("decideNusaAdaptiveConcurrency", () => {
  it("fails closed to one active item when evidence is insufficient", () => {
    const result = decideNusaAdaptiveConcurrency({
      mergedWorkCount: 3,
      reworkCount: 0,
      conflictCount: 0,
      ciCapacitySlots: null,
      ciPeakConcurrentJobs: null,
    });
    assert.equal(result.maximumActiveWorkPerOwner, 1);
    assert.equal(result.classification, "CONSERVATIVE");
  });

  it("keeps concurrency conservative when measured conflict or rework is high", () => {
    const conflict = decideNusaAdaptiveConcurrency({
      mergedWorkCount: 10,
      reworkCount: 0,
      conflictCount: 2,
      ciCapacitySlots: 4,
      ciPeakConcurrentJobs: 2,
    });
    assert.equal(conflict.maximumActiveWorkPerOwner, 1);
    assert.ok(conflict.reasons.includes("CONFLICT_RATE_TOO_HIGH"));

    const rework = decideNusaAdaptiveConcurrency({
      mergedWorkCount: 10,
      reworkCount: 3,
      conflictCount: 0,
      ciCapacitySlots: 4,
      ciPeakConcurrentJobs: 2,
    });
    assert.equal(rework.maximumActiveWorkPerOwner, 1);
    assert.ok(rework.reasons.includes("REWORK_RATE_TOO_HIGH"));
  });

  it("does not increase WIP without evidenced spare CI capacity", () => {
    const result = decideNusaAdaptiveConcurrency({
      mergedWorkCount: 10,
      reworkCount: 0,
      conflictCount: 0,
      ciCapacitySlots: 2,
      ciPeakConcurrentJobs: 2,
    });
    assert.equal(result.maximumActiveWorkPerOwner, 1);
    assert.ok(result.reasons.includes("NO_EVIDENCED_CI_SPARE_CAPACITY"));
  });

  it("allows only bounded WIP two when throughput quality and CI capacity support it", () => {
    const result = decideNusaAdaptiveConcurrency({
      mergedWorkCount: 10,
      reworkCount: 1,
      conflictCount: 1,
      ciCapacitySlots: 4,
      ciPeakConcurrentJobs: 2,
    });
    assert.equal(result.maximumActiveWorkPerOwner, 2);
    assert.equal(result.classification, "MEASURED");
  });

  it("rejects malformed evidence instead of converting UNKNOWN into confidence", () => {
    assert.throws(() => decideNusaAdaptiveConcurrency({
      mergedWorkCount: -1,
      reworkCount: 0,
      conflictCount: 0,
      ciCapacitySlots: 2,
      ciPeakConcurrentJobs: 1,
    }), /ADAPTIVE_CONCURRENCY_INVALID_MERGEDWORKCOUNT/);
    assert.throws(() => decideNusaAdaptiveConcurrency({
      mergedWorkCount: 4,
      reworkCount: 0,
      conflictCount: 0,
      ciCapacitySlots: 0,
      ciPeakConcurrentJobs: 1,
    }), /ADAPTIVE_CONCURRENCY_INVALID_CICAPACITYSLOTS/);
  });
});
