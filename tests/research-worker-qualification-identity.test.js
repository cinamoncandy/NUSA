const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { ClosedLearningResearchWorkerClient } = require("../dist/apps/cloud/src/closedLearningResearchWorkerClient.js");
const { RESEARCH_FACTORY_QUALIFICATION_POLICY } = require("../dist/apps/desktop/src/cloud/researchFactoryQualification.js");
const ORIGINAL = "a".repeat(64);
const REPLAY = "b".repeat(64);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value != null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
const hash = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
function payload() {
  const result = {
    schemaVersion: 1,
    candidates: [{ candidateId: "r", outcome: "REJECTED", reasons: ["FAIL"], summary: "rejected" }],
    coverage: { candidateCount: 1, qualifiedCount: 0, insufficientCount: 0, rejectedCount: 1 },
    liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY",
  };
  const identity = { policyId: "research-factory-qualification-v1", policySha256: hash(RESEARCH_FACTORY_QUALIFICATION_POLICY), runFingerprintSha256: REPLAY };
  return {
    schemaVersion: 1, operation: "REPLAY_PAPER_EVIDENCE",
    originalRunFingerprintSha256: ORIGINAL, replayRunFingerprintSha256: REPLAY,
    qualification: { ...result, validationIdentity: { schemaVersion: 1, ...identity, resultSha256: hash({ ...identity, result }) } },
    deployment: { schemaVersion: 1, status: "NOT_DEPLOYABLE", reasons: ["NO_ALLOCATION"], authority: "PAPER_RESEARCH_ONLY", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" },
    liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY",
  };
}
function decode(value) {
  return new ClosedLearningResearchWorkerClient({
    snapshotPath: path.resolve("/tmp/research-identity-snapshot.json"),
    process: () => ({ status: 0, stdout: JSON.stringify(value), stderr: "" }),
  }).replayInitialResearch(ORIGINAL);
}
test("Cloud worker preserves the independently sealed qualification identity", () => {
  const value = payload();
  assert.equal(value.qualification.validationIdentity.policySha256, "6d1ea806bdb5056f2b3ab095033b127a53fe74b0c8a92dbb1030adfa3235f542");
  assert.equal(value.qualification.validationIdentity.resultSha256, "32a11896262117f9a272dc936218639a751ffa8592676c81c6d5671735c5f330");
  const result = decode(value);
  assert.deepEqual(result.qualification.validationIdentity, value.qualification.validationIdentity);
  assert.ok(Object.isFrozen(result.qualification.validationIdentity));
});
test("Cloud worker rejects missing, malformed, foreign-run and substituted receipts", () => {
  const changes = [
    (p) => { delete p.qualification.validationIdentity; },
    (p) => { p.qualification.validationIdentity = []; },
    (p) => { p.qualification.validationIdentity.schemaVersion = 2; },
    (p) => { p.qualification.validationIdentity.policyId = "unknown"; },
    (p) => { p.qualification.validationIdentity.policySha256 = "0".repeat(64); },
    (p) => { p.qualification.validationIdentity.runFingerprintSha256 = ORIGINAL; },
    (p) => { p.qualification.validationIdentity.resultSha256 = "0".repeat(64); },
    (p) => { p.qualification.candidates[0].summary = "substituted"; },
    (p) => { p.qualification.candidates[0].summary = " rejected "; },
  ];
  for (const change of changes) {
    const value = payload(); change(value);
    assert.throws(() => decode(value), /qualification.*identity|qualification.*checksum/);
  }
});
