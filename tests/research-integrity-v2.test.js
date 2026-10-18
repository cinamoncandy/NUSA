const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateResearchDatasetProvenanceSha256 } = require("../dist/packages/contracts/src/researchDatasetSemantics.js");
const { requireCurrentResearchDatasetIdentity } = require("../dist/apps/desktop/src/cloud/researchIntegrity.js");

test("current dataset identity binds schema v2 provenance suffix", () => {
  const contentSha256 = "a".repeat(64);
  const provenance = { rawSourceIdentitySha256s:["1".repeat(64)], transformationGraphSha256:"2".repeat(64), transformationConfigSha256:"3".repeat(64), schemaContractSha256:"4".repeat(64), qualitySuiteSha256:"5".repeat(64), qualityResultsSha256:"6".repeat(64), derivedFeatureLineageSha256:"7".repeat(64), replayRuntimeSha256:"8".repeat(64) };
  const suffix = `_v2_${contentSha256.slice(0,12)}_${calculateResearchDatasetProvenanceSha256(provenance).slice(0,12)}`;
  const manifest = { schemaVersion:2, datasetId:`dataset${suffix}`, source:"upbit-public-api", market:"KRW-BTC", interval:"60m",
    candleCount:2, startOpenTime:0, endCloseTime:7_200_000, timezone:"UTC", ordering:"OPEN_TIME_ASC",
    missingCandlePolicy:"REJECT", missingCandleCount:0, createdAt:"2026-09-30T00:00:00.000Z", contentSha256, provenance };
  const freshness = { source:"upbit-public-api", market:"KRW-BTC", interval:"60m", asOf:7_500_000,
    expectedLatestCloseTime:7_200_000, actualLatestCloseTime:7_200_000, lagIntervals:0, fresh:true };
  assert.equal(requireCurrentResearchDatasetIdentity({ manifest, freshness, observedAt:7_500_000 }).datasetId, manifest.datasetId);
  assert.throws(() => requireCurrentResearchDatasetIdentity({ manifest:{...manifest, datasetId:"forged"}, freshness, observedAt:7_500_000 }), /INVALID_CURRENT_DATASET_IDENTITY:provenance/);
});
