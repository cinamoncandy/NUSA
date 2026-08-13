const test = require("node:test");
const assert = require("node:assert/strict");
const { aiSha256 } = require("../dist/packages/contracts/src/aiInference.js");
const { verifyAiExplanation } = require("../dist/apps/cloud/src/ai/explanationFaithfulnessVerifier.js");

const policy = Object.freeze({ schemaVersion: 1, policyId: "EXPLANATION_TEST", policyVersion: "1", maxClaims: 4, maxEvidencePerClaim: 2, materialCounterEvidenceIds: Object.freeze([]), minimumConfidenceForAssertiveLanguage: 0.7, resourcePolicyIdentity: "WO-AI-006:1" });
function make(overrides = {}) {
  const base = { schemaVersion: 1, explanationId: "ex-1", policy, lineage: { decisionId: "d-1", decisionDigest: "d", providerId: "p", modelVersionId: "m", promptArtifactDigest: "a", schemaVersion: "1", calibrationIdentity: "c", scenarioIdentity: null, attributionIdentity: null, canonicalInputHash: "input", replayIdentity: "replay", holdoutPartitionIdentity: "holdout" }, claims: [{ claimId: "c-1", text: "observed", citedEvidenceIds: ["e-1"], provenance: "OBSERVED", assertive: true }], evidence: [{ evidenceId: "e-1", digest: "digest", provenance: "OBSERVED", supportsClaimIds: ["c-1"], contradictsClaimIds: [], material: false }], confidence: 0.9, abstained: false, providerDisagreement: false, attributionStrength: "IDENTIFIED", observedAt: 1 };
  const value = { ...base, ...overrides };
  return Object.freeze({ ...value, contentDigest: aiSha256(value) });
}

test("supported claim passes with exact lineage", () => { const result = verifyAiExplanation(make()); assert.equal(result.verdict, "PASS"); assert.equal(result.claimStatuses["c-1"], "SUPPORTED"); assert.equal(result.productionMutationAllowed, false); });
test("missing or wrong evidence fails closed", () => { const result = verifyAiExplanation(make({ claims: [{ ...make().claims[0], citedEvidenceIds: ["missing"] }] })); assert.equal(result.verdict, "ABSTAIN"); assert.equal(result.claimStatuses["c-1"], "UNVERIFIED"); });
test("evidence that does not bind support to the cited claim fails closed", () => { const result = verifyAiExplanation(make({ evidence: [{ ...make().evidence[0], supportsClaimIds: [] }] })); assert.equal(result.verdict, "ABSTAIN"); assert.equal(result.claimStatuses["c-1"], "UNVERIFIED"); assert.ok(result.reasonCodes.includes("UNVERIFIED_CLAIM")); });
test("duplicate evidence or claim identities fail closed", () => { const result = verifyAiExplanation(make({ evidence: [make().evidence[0], { ...make().evidence[0] }] })); assert.equal(result.verdict, "ABSTAIN"); assert.ok(result.reasonCodes.includes("DUPLICATE_EVIDENCE_OR_CLAIM_ID")); });
test("hypothetical evidence cannot support observed claim", () => { const result = verifyAiExplanation(make({ evidence: [{ ...make().evidence[0], provenance: "HYPOTHETICAL" }] })); assert.equal(result.verdict, "ABSTAIN"); });
test("counterevidence omission and provider disagreement abstain", () => { const p = { ...policy, materialCounterEvidenceIds: ["e-2"] }; const result = verifyAiExplanation(make({ policy: p, providerDisagreement: true, evidence: [{ ...make().evidence[0] }, { evidenceId: "e-2", digest: "x", provenance: "OBSERVED", supportsClaimIds: [], contradictsClaimIds: ["c-1"], material: true }] })); assert.equal(result.verdict, "ABSTAIN"); assert.ok(result.reasonCodes.includes("PROVIDER_DISAGREEMENT_HIDDEN")); });
test("replay is deterministic and attribution cannot overclaim", () => { const one = verifyAiExplanation(make({ attributionStrength: "UNRESOLVED", claims: [{ ...make().claims[0], attributionStrength: "IDENTIFIED" }] })); const two = verifyAiExplanation(make({ attributionStrength: "UNRESOLVED", claims: [{ ...make().claims[0], attributionStrength: "IDENTIFIED" }] })); assert.deepEqual(one, two); assert.ok(one.reasonCodes.includes("ATTRIBUTION_OVERCLAIM")); });

