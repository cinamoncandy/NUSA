import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLearningEvidenceAuthorityFromReaders } from "./learningEvidenceAuthority";

describe("LearningEvidenceAuthority", () => {
  it("delegates reads to durable readers instead of copying evidence", () => {
    let observedAt = 10;
    const authority = createLearningEvidenceAuthorityFromReaders({
      readResearch: (recordId) => recordId === "r" ? { recordId, recordedAt: observedAt } : undefined,
      readPaper: (recordId) => recordId === "p" ? { recordId, recordedAt: 20 } : undefined,
    });
    assert.deepEqual(authority.readResearch("r"), { recordId: "r", recordedAt: 10 });
    observedAt = 11;
    assert.deepEqual(authority.readResearch("r"), { recordId: "r", recordedAt: 11 });
    assert.equal(authority.readResearch("missing"), undefined);
  });
});
