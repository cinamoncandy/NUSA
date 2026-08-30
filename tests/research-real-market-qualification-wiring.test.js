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
