const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { runStrategyResearchScorecard, EVIDENCE_ORDER } = require("../scripts/lib/strategy-research-promotion-gate-runner.js");
const { canonicalHash } = require("../scripts/lib/canonical-hash.js");

const dir = path.join(__dirname, "fixtures", "strategy-promotion-gate");
const load = (name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8"));
const fixtures = fs.readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => name.replace(/\.json$/, ""));

test("repeated runs over the same request produce byte-identical results", () => {
  for (const name of fixtures) {
    const first = runStrategyResearchScorecard(load(name));
    const second = runStrategyResearchScorecard(load(name));
    assert.equal(canonicalHash(first), canonicalHash(second), `${name} is not deterministic`);
  }
});

test("no wall-clock timestamp leaks into the result or its hashes", () => {
  const result = runStrategyResearchScorecard(load("promote-review"));
  const serialized = JSON.stringify(result);
  const thisYear = String(new Date().getUTCFullYear());
  // The only timestamps allowed are ones copied verbatim from the request's evidence.
  const declared = new Set((load("promote-review").manifest.evidence ?? []).map((entry) => entry.generatedAt));
  for (const match of serialized.match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g) ?? []) {
    assert.ok(declared.has(match), `undeclared timestamp leaked into the result: ${match}`);
  }
  assert.equal(serialized.includes(`"generatedAt":"${thisYear}-`) && !declared.size, false);
});

test("evidence is reported in canonical order regardless of input order", () => {
  const request = load("promote-review");
  const shuffled = load("promote-review");
  shuffled.manifest.evidence = [...shuffled.manifest.evidence].reverse();
  const ordered = runStrategyResearchScorecard(request);
  const reversed = runStrategyResearchScorecard(shuffled);
  assert.deepEqual(ordered.evidenceManifest.map((entry) => entry.evidenceType), [...EVIDENCE_ORDER]);
  assert.deepEqual(reversed.evidenceManifest.map((entry) => entry.evidenceType), [...EVIDENCE_ORDER]);
  assert.equal(canonicalHash(ordered.dimensions), canonicalHash(reversed.dimensions));
  assert.equal(ordered.researchDecision, reversed.researchDecision);
});

test("dimensions are always reported in D-001..D-010 order", () => {
  for (const name of fixtures) {
    const ids = runStrategyResearchScorecard(load(name)).dimensions.map((dimension) => dimension.id);
    assert.deepEqual(ids, [...ids].sort(), `${name} reports dimensions out of order`);
  }
});

test("every hash changes when the thing it covers changes", () => {
  const base = runStrategyResearchScorecard(load("promote-review"));
  const altered = load("promote-review");
  altered.manifest.evidence = altered.manifest.evidence.map((entry) =>
    entry.evidenceType === "PARAMETER_ROBUSTNESS" ? { ...entry, metrics: { ...entry.metrics, plateauClassification: "FLAT_WEAK" } } : entry);
  const other = runStrategyResearchScorecard(altered);
  assert.notEqual(other.researchDecision, base.researchDecision);
  assert.notEqual(base.hashes.requestSha256, other.hashes.requestSha256);
  assert.notEqual(base.hashes.dimensionsSha256, other.hashes.dimensionsSha256);
  assert.notEqual(base.hashes.blockersSha256, other.hashes.blockersSha256);
  assert.notEqual(base.hashes.decisionSha256, other.hashes.decisionSha256);
  assert.notEqual(base.hashes.finalResultSha256, other.hashes.finalResultSha256);
});

test("each hash covers only its own scope", () => {
  // Weakening one dimension without moving the gate must change dimensionsSha256 while
  // leaving decisionSha256 alone; a decision hash that moved anyway would be covering
  // more than the decision and would stop being a useful tamper check.
  const base = runStrategyResearchScorecard(load("promote-review"));
  const altered = load("promote-review");
  altered.manifest.evidence = altered.manifest.evidence.map((entry) =>
    entry.evidenceType === "PARAMETER_ROBUSTNESS" ? { ...entry, metrics: { ...entry.metrics, plateauClassification: "NARROW_PLATEAU" } } : entry);
  const other = runStrategyResearchScorecard(altered);
  assert.equal(other.researchDecision, base.researchDecision);
  assert.notEqual(base.hashes.dimensionsSha256, other.hashes.dimensionsSha256);
  assert.equal(base.hashes.decisionSha256, other.hashes.decisionSha256);
});

test("the strategy fingerprint recorded in the hashes comes from the request", () => {
  const request = load("promote-review");
  const result = runStrategyResearchScorecard(request);
  assert.equal(result.hashes.strategyFingerprint, request.strategy.strategyFingerprint);
});

test("the scorecard never mutates the request it was given", () => {
  const request = load("promote-review");
  const before = canonicalHash(request);
  runStrategyResearchScorecard(request);
  assert.equal(canonicalHash(request), before);
});

test("the scorecard never recomputes or rewrites the underlying research results", () => {
  // It reads declared metrics only. A metric absent from the manifest must surface as
  // null or a shortfall -- never as a value the scorecard invented for itself.
  const request = load("promote-review");
  request.manifest.evidence = request.manifest.evidence.map((entry) =>
    entry.evidenceType === "WALK_FORWARD" ? { ...entry, metrics: {} } : entry);
  const result = runStrategyResearchScorecard(request);
  const oos = result.dimensions.find((dimension) => dimension.id === "D-004");
  assert.equal(oos.metrics.compoundedOosReturn, null);
  assert.equal(oos.status, "INCONCLUSIVE");
});
