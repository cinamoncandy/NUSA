const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "research-real-market-run.js"), "utf8");

test("real-market research run consumes the canonical factory qualification gate", () => {
  assert.match(
    source,
    /const \{ qualifyResearchFactoryRun \} = require\("\.\.\/dist\/apps\/desktop\/src\/cloud\/researchFactoryQualification\.js"\);/
  );
  assert.match(source, /const factoryQualification = qualifyResearchFactoryRun\(league\);/);
  assert.match(source, /researchFactoryQualification: factoryQualification,/);
  assert.match(source, /researchRunProvenance: league\.provenance,/);

  const buildIndex = source.indexOf("const league = buildResearchRunLeague(");
  const qualificationIndex = source.indexOf("const factoryQualification = qualifyResearchFactoryRun(league);");
  const outputIndex = source.indexOf("researchFactoryQualification: factoryQualification,");
  const provenanceOutputIndex = source.indexOf("researchRunProvenance: league.provenance,");
  assert.ok(
    buildIndex >= 0
      && qualificationIndex > buildIndex
      && outputIndex > qualificationIndex
      && provenanceOutputIndex > outputIndex,
  );
});

test("real-market qualification wiring does not weaken research-only authority", () => {
  assert.match(source, /REAL_MARKET_DATA_RESEARCH_TIER_ONLY -- not operational Paper evidence, does not authorize release/);
  assert.doesNotMatch(source, /liveAuthority\s*:\s*[^"']*(?:FULL|ENABLED|ACTIVE)/i);
});
test("PBO insufficiency is projected as an explicit unavailable state without swallowing integrity failures", () => {
  const { isResearchRunPboEvidenceUnavailable } = require("../scripts/research-real-market-run.js");
  for (const code of [
    "ZERO_RETURN_VARIANCE",
    "INSUFFICIENT_CANDIDATES",
    "INSUFFICIENT_OOS_EQUITY_POINTS",
    "INSUFFICIENT_OOS_RETURN_POINTS",
    "NO_SYMMETRIC_CSCV_PARTITION"
  ]) {
    assert.equal(isResearchRunPboEvidenceUnavailable({ code }), true, code);
  }
  for (const code of [
    "DATASET_PROVENANCE_MISMATCH",
    "OOS_TIMESTAMP_ALIGNMENT_MISMATCH",
    "INVALID_OOS_TIMESTAMP",
    "NON_FINITE_OOS_RETURN"
  ]) {
    assert.equal(isResearchRunPboEvidenceUnavailable({ code }), false, code);
  }
  assert.equal(isResearchRunPboEvidenceUnavailable(undefined), false);
});
