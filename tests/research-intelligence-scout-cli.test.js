const test = require("node:test");
const assert = require("node:assert/strict");
const { advisoryAvailability } = require("../scripts/research-intelligence-scout.js");

test("public-source outages remain explicit INSUFFICIENT_DATA advisory evidence", () => {
  assert.equal(advisoryAvailability({ records: [], sourceErrors: [{ sourceId: "arxiv", reason: "HTTP 503" }] }), "INSUFFICIENT_DATA");
});

test("an advisory scout distinguishes available and no-match evidence", () => {
  assert.equal(advisoryAvailability({ records: [{ recordId: "r1" }], sourceErrors: [] }), "AVAILABLE");
  assert.equal(advisoryAvailability({ records: [], sourceErrors: [] }), "NO_MATCHING_RESEARCH");
});
