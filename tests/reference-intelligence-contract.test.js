const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createReferenceIntelligenceRecord,
  validateReferenceOwnerRouting,
  canEnterReferenceValidation,
} = require("../dist/packages/contracts/src/referenceIntelligence.js");

function input(overrides = {}) {
  return {
    sourceType: "OPEN_SOURCE",
    sourceLocator: "github:example/reference-system",
    sourceUrl: "https://github.com/example/reference-system",
    sourceVersion: "v1.2.3",
    discoveredAt: "2026-09-20T06:00:00.000Z",
    sourcePublishedAt: "2026-09-19T00:00:00.000Z",
    category: "DEVELOPER_AUTOMATION",
    title: "Reference worker system",
    description: "A conflict-aware worker allocator with durable evidence.",
    claimedAdvantage: "Lower stale-work rate through isolated claims.",
    evidenceStrength: "INDEPENDENT_SUPPORT",
    evidenceRefs: ["benchmark:reference-v1", "docs:architecture-v1"],
    actualBetterDimensions: ["stale-work rate", "owner-perceived latency"],
    principleToAbsorb: ["isolate conflict identities before worker admission"],
    doNotAbsorb: ["agent-count marketing metric"],
    nusaGap: ["current worker admission lacks the same measured isolation evidence"],
    rootCause: ["conflict identity is not measured at the same granularity"],
    proposedImprovement: ["add a bounded conflict-identity admission check"],
    canonicalOwner: "AUTOPILOT",
    validationProposal: ["compare stale-work rate before and after on the same workload class"],
    measurement: ["stale-work rate", "instruction-to-first-verified-result latency"],
    expectedValueDimensions: ["LATENCY", "AUTONOMY", "RELIABILITY"],
    expectedValueMagnitude: "MEDIUM",
    implementationCost: "LOW",
    regressionRisk: "LOW",
    remainingUncertainty: ["reference workload may not match NUSA workload"],
    relatedReferenceIds: [],
    ...overrides,
  };
}

test("reference identity is deterministic across rediscovery time", () => {
  const first = createReferenceIntelligenceRecord(input());
  const second = createReferenceIntelligenceRecord(input({
    discoveredAt: "2026-09-20T18:00:00.000Z",
  }));

  assert.equal(first.referenceId, second.referenceId);
  assert.equal(first.identityFingerprint, second.identityFingerprint);
  assert.equal(first.priorityScore, "UNSCORED_EVIDENCE_BOUND");
  assert.equal(first.authority, "PAPER_ONLY");
  assert.equal(first.liveAuthority, "NONE");
  assert.equal(first.productionMutationAllowed, false);
  assert.equal(first.aiAuthority, "ZERO_AUTHORITY");
});

test("claim-only references remain advisory and cannot enter validation", () => {
  const record = createReferenceIntelligenceRecord(input({
    evidenceStrength: "CLAIM_ONLY",
  }));
  assert.equal(canEnterReferenceValidation(record), false);
});

test("supported references with bounded gaps and measurements may enter validation", () => {
  const record = createReferenceIntelligenceRecord(input());
  assert.equal(canEnterReferenceValidation(record), true);
});

test("default owner routing mismatch requires Core resolution", () => {
  const record = createReferenceIntelligenceRecord(input({
    canonicalOwner: "CORE",
  }));
  assert.deepEqual(validateReferenceOwnerRouting(record), {
    expectedOwner: "AUTOPILOT",
    actualOwner: "CORE",
    requiresCoreResolution: true,
  });
});

test("missing bounded gap or measurement fails closed", () => {
  assert.throws(
    () => createReferenceIntelligenceRecord(input({ nusaGap: [] })),
    /nusaGap requires/,
  );
  assert.throws(
    () => createReferenceIntelligenceRecord(input({ measurement: [] })),
    /measurement requires/,
  );
});

test("non-HTTPS source URLs are rejected", () => {
  assert.throws(
    () => createReferenceIntelligenceRecord(input({ sourceUrl: "http://example.com/ref" })),
    /sourceUrl must use HTTPS/,
  );
});
