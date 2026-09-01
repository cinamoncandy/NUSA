const assert = require("node:assert/strict");
const test = require("node:test");

const {
  REQUIRED_CHART_ROLES,
  REQUIRED_SAFETY,
  REQUIRED_UI_ROLES,
  validateAndroidReleaseContract,
  validateContractShape,
} = require("../scripts/validate-android-release-contract.js");

test("Android stable release contract preserves immutable safety floor and semantic roles", () => {
  const { contract, markerHits } = validateAndroidReleaseContract();

  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.releaseMode, "PAPER_SHADOW_ONLY");
  assert.deepEqual(contract.safety, REQUIRED_SAFETY);

  for (const role of REQUIRED_UI_ROLES) {
    const marker = contract.uiMarkers[role];
    assert.equal(typeof marker, "string");
    assert.ok(markerHits.get(marker)?.length > 0, `${role} marker must exist in production source`);
  }

  for (const role of REQUIRED_CHART_ROLES) {
    const marker = contract.chartMarkers[role];
    assert.equal(typeof marker, "string");
    assert.ok(markerHits.get(marker)?.length > 0, `${role} marker must exist in production source`);
  }
});

test("Android stable release contract rejects safety-floor weakening", () => {
  const { contract } = validateAndroidReleaseContract();
  const weakened = structuredClone(contract);
  weakened.safety.liveAuthority = "LIVE";
  assert.throws(
    () => validateContractShape(weakened),
    /safety\.liveAuthority must equal "NONE"/,
  );
});

test("Android stable release contract rejects removal of a protected semantic role", () => {
  const { contract } = validateAndroidReleaseContract();
  const drifted = structuredClone(contract);
  delete drifted.uiMarkers.homePaperLearning;
  assert.throws(
    () => validateContractShape(drifted),
    /uiMarkers\.homePaperLearning is required/,
  );
});
