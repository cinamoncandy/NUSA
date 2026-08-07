const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { validateDocument } = require("../scripts/validate-champion-challenger.js");

const root = join(__dirname, "..");
const base = JSON.parse(readFileSync(join(root, "config/research/champion-challenger.json"), "utf8"));
const capabilities = JSON.parse(readFileSync(join(root, "config/capabilities/registry.json"), "utf8"));
const clone = () => structuredClone(base);
const failures = (doc) => validateDocument(doc, capabilities).failures;

test("valid Champion/Challenger registry passes", () => {
  assert.deepEqual(validateDocument(clone(), capabilities), { ok: true, failures: [] });
});

test("unknown capability contract fails closed", () => {
  const doc = clone();
  doc.evaluations[0].contract_version = "9.9.9";
  assert.ok(failures(doc).some((value) => value.startsWith("UNKNOWN_CAPABILITY_CONTRACT:")));
});

test("champion and challenger cannot be the same identity", () => {
  const doc = clone();
  doc.evaluations[0].challenger.id = doc.evaluations[0].champion.id;
  assert.ok(failures(doc).some((value) => value.startsWith("CANDIDATE_IDENTITY_INVALID:")));
});

test("sealed holdout cannot become mutable after registration", () => {
  const doc = clone();
  doc.evaluations[0].evaluation.holdout.mutable_after_registration = true;
  assert.ok(failures(doc).some((value) => value.startsWith("SEALED_DATASET_MUTABLE:")));
});

test("candidate cannot evaluate itself", () => {
  const doc = clone();
  doc.evaluations[0].evaluation.authority.evaluator_id = doc.evaluations[0].challenger.id;
  assert.ok(failures(doc).some((value) => value.startsWith("SELF_EVALUATION:")));
});

test("Meta-AI proposer cannot also be promotion authority", () => {
  const doc = clone();
  const authority = doc.evaluations[0].evaluation.authority;
  authority.promotion_authority_id = authority.proposer_id;
  assert.ok(failures(doc).some((value) => value.startsWith("META_AI_SELF_PROMOTION:")));
});

test("declared lineage independence must match actual lineage", () => {
  const doc = clone();
  doc.evaluations[0].lineage_independence.differing_dimensions = ["model"];
  assert.ok(failures(doc).some((value) => value.startsWith("LINEAGE_INDEPENDENCE_MISMATCH:")));
});

test("evaluation provenance is mandatory", () => {
  const doc = clone();
  doc.evaluations[0].evaluation.provenance = [];
  assert.ok(failures(doc).some((value) => value.startsWith("PROVENANCE_MISSING:")));
});
