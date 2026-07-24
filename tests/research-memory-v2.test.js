const test = require("node:test");
const assert = require("node:assert/strict");
const { createResearchMemoryRecord, validateResearchTimeline } = require("../dist/apps/cloud/src/researchMemoryV2.js");

const base = {
  researchId: "research-001",
  createdAt: "2026-07-13T12:00:00.000Z",
  author: "research-ai",
  summary: "Why does extreme funding revert?",
  payload: Object.freeze({ market: "BTC", horizon: "4h" })
};

test("creates deterministic immutable records", () => {
  const a = createResearchMemoryRecord({ ...base, recordId: "q1", stage: "QUESTION" });
  const b = createResearchMemoryRecord({ ...base, recordId: "q1", stage: "QUESTION" });
  assert.equal(a.contentHash, b.contentHash);
  assert.ok(Object.isFrozen(a));
  assert.ok(Object.isFrozen(a.payload));
  assert.ok(Object.isFrozen(a.parentRecordIds));
});

test("requires evidence direction only for evidence records", () => {
  assert.throws(() => createResearchMemoryRecord({ ...base, recordId: "e1", stage: "EVIDENCE" }), /evidenceDirection/);
  assert.throws(() => createResearchMemoryRecord({ ...base, recordId: "q1", stage: "QUESTION", evidenceDirection: "SUPPORTS" }), /evidenceDirection/);
});

test("validates parent ordering and research isolation", () => {
  const question = createResearchMemoryRecord({ ...base, recordId: "q1", stage: "QUESTION" });
  const hypothesis = createResearchMemoryRecord({
    ...base,
    recordId: "h1",
    stage: "HYPOTHESIS",
    createdAt: "2026-07-13T12:01:00.000Z",
    parentRecordIds: Object.freeze(["q1"])
  });
  const timeline = validateResearchTimeline([hypothesis, question]);
  assert.deepEqual(timeline.map((item) => item.recordId), ["q1", "h1"]);
  assert.ok(Object.isFrozen(timeline));

  const foreign = createResearchMemoryRecord({
    ...base,
    researchId: "research-002",
    recordId: "x1",
    stage: "LESSON",
    createdAt: "2026-07-13T12:02:00.000Z",
    parentRecordIds: Object.freeze(["q1"])
  });
  assert.throws(() => validateResearchTimeline([question, foreign]), /cross-research/);
});

test("rejects duplicate, missing, future, and self references", () => {
  const question = createResearchMemoryRecord({ ...base, recordId: "q1", stage: "QUESTION" });
  assert.throws(() => validateResearchTimeline([question, question]), /duplicate recordId/);
  assert.throws(() => validateResearchTimeline([
    question,
    createResearchMemoryRecord({ ...base, recordId: "h1", stage: "HYPOTHESIS", parentRecordIds: ["missing"] })
  ]), /missing parent record/);
  assert.throws(() => createResearchMemoryRecord({ ...base, recordId: "q1", stage: "QUESTION", parentRecordIds: ["q1"] }), /reference itself/);
});
