import test from "node:test";
import assert from "node:assert/strict";
import {
  assertDeterministicReplay, assertFeatureBinding, assertSegmentIsolation, evidenceFingerprint,
  featureFingerprint, oosReuseFingerprint, validateEvidenceProvenance, validatePointInTimeBoundary,
  assertResearchUniverseDatasetBinding, assertResearchUniverseDatasetSetBinding, assertResearchUniverseReplay, researchUniverseFingerprint,
  validateResearchUniverseProvenance
} from "../apps/desktop/src/cloud/researchIntegrity.ts";

const D = "a".repeat(64), G = "b".repeat(40);
const feature = { featureId:"close-return", featureVersion:"1", datasetFingerprint:D, inputCutoff:200, parameters:{ lookback:20 } };
const provenance = {
  evidenceKind:"REAL" as const, datasetFingerprint:D, featureFingerprint:featureFingerprint(feature),
  strategyId:"s1", strategyVersion:"1", familyId:"trend.test", engineVersion:"1", gitCommitSha:G,
  researchRunId:"run-1", createdAt:"2026-09-19T00:00:00.000Z"
};

test("point-in-time accepts causal availability", () => {
  assert.doesNotThrow(() => validatePointInTimeBoundary({ observedAt:100, availableAt:150, featureCutoff:150, decisionAt:200 }));
});
test("future information is rejected", () => {
  assert.throws(() => validatePointInTimeBoundary({ observedAt:100, availableAt:250, featureCutoff:100, decisionAt:200 }), /FUTURE_LEAKAGE/);
  assert.throws(() => validatePointInTimeBoundary({ observedAt:100, availableAt:150, featureCutoff:201, decisionAt:200 }), /FUTURE_LEAKAGE/);
});
test("feature fingerprint is deterministic and dataset-bound", () => {
  const fp=featureFingerprint(feature); assert.equal(fp, featureFingerprint({...feature, parameters:{lookback:20}}));
  assert.doesNotThrow(() => assertFeatureBinding(feature,D,fp));
  assert.throws(() => assertFeatureBinding(feature,"c".repeat(64),fp), /DATASET_FINGERPRINT_MISMATCH/);
  assert.throws(() => assertFeatureBinding(feature,D,"d".repeat(64)), /FEATURE_FINGERPRINT_MISMATCH/);
});
test("train validation OOS must be ordered and isolated", () => {
  assert.doesNotThrow(() => assertSegmentIsolation({id:"train",startAt:0,endAt:100},{id:"validation",startAt:100,endAt:150},{id:"oos",startAt:150,endAt:200}));
  assert.throws(() => assertSegmentIsolation({id:"train",startAt:0,endAt:101},undefined,{id:"oos",startAt:100,endAt:200}), /TRAIN_OOS_CONTAMINATION/);
});
test("OOS reuse identity is deterministic and dataset-bound", () => {
  const o={id:"oos",startAt:100,endAt:200};
  assert.equal(oosReuseFingerprint(o,D),oosReuseFingerprint(o,D));
  assert.notEqual(oosReuseFingerprint(o,D),oosReuseFingerprint(o,"c".repeat(64)));
});
test("synthetic evidence cannot be promotion eligible", () => {
  assert.doesNotThrow(() => validateEvidenceProvenance(provenance,{promotionEligible:true}));
  assert.throws(() => validateEvidenceProvenance({...provenance,evidenceKind:"SYNTHETIC"},{promotionEligible:true}), /SYNTHETIC_EVIDENCE_PROMOTION_FORBIDDEN/);
});
test("missing or corrupt provenance fails closed", () => {
  assert.throws(() => validateEvidenceProvenance({...provenance,researchRunId:""}), /MISSING_PROVENANCE/);
  assert.throws(() => validateEvidenceProvenance({...provenance,gitCommitSha:"unknown"}), /INVALID_PROVENANCE/);
});
test("evidence fingerprint detects mutation and replay divergence", () => {
  const evidence={return:0.1,trades:12}; const fp=evidenceFingerprint(provenance,evidence);
  assert.doesNotThrow(() => assertDeterministicReplay(fp,provenance,{trades:12,return:0.1}));
  assert.throws(() => assertDeterministicReplay(fp,provenance,{trades:13,return:0.1}), /REPLAY_NON_DETERMINISTIC/);
});
test("contract exposes no execution or LIVE authority", async () => {
  const source=await import("node:fs").then(fs=>fs.readFileSync(new URL("../apps/desktop/src/cloud/researchIntegrity.ts",import.meta.url),"utf8"));
  assert.doesNotMatch(source,/placeOrder|withdraw|transfer|liveAuthority\s*=\s*(?!NONE)/i);
});

test("real-market runner binds canonical integrity before factory qualification", async () => {
  const source=await import("node:fs").then(fs=>fs.readFileSync(new URL("../scripts/research-real-market-run.js",import.meta.url),"utf8"));
  assert.match(source,/researchIntegrity\.js/);
  assert.match(source,/datasetFingerprint:\s*manifest\.contentSha256/);
  assert.match(source,/featureFingerprint\(featureIdentity\)/);
  assert.match(source,/validateEvidenceProvenance\(provenance,\s*\{\s*promotionEligible:\s*true\s*\}\)/);
  assert.match(source,/validateEvidenceProvenance[\s\S]*qualifyResearchFactoryRun\(league\)/);
  assert.match(source,/evidenceKind:\s*"REAL"/);
});


const universe = {
  schemaVersion: 1 as const,
  universeId: "upbit-krw-active",
  version: "2026-08-29",
  asOf: 200,
  availableAt: 210,
  selectionPolicyId: "listed-krw-v1",
  source: "upbit-market-snapshot",
  constituents: [
    { market:"KRW-BTC", datasetId:"d-btc", datasetContentSha256:D, eligibleFrom:100, evidenceRef:"snapshot:btc" },
    { market:"KRW-ETH", datasetId:"d-eth", datasetContentSha256:"c".repeat(64), eligibleFrom:120, evidenceRef:"snapshot:eth" },
  ],
};

test("point-in-time research universe fingerprint is deterministic and order-independent", () => {
  const reversed = { ...universe, constituents:[...universe.constituents].reverse() };
  assert.equal(researchUniverseFingerprint(universe), researchUniverseFingerprint(reversed));
  assert.doesNotThrow(() => validateResearchUniverseProvenance(universe,{decisionAt:220}));
});

test("universe provenance rejects future membership and unavailable snapshots", () => {
  assert.throws(
    () => validateResearchUniverseProvenance({ ...universe, availableAt:221 },{decisionAt:220}),
    /FUTURE_LEAKAGE:universe_unavailable_at_decision/,
  );
  assert.throws(
    () => validateResearchUniverseProvenance({ ...universe, constituents:[{...universe.constituents[0],eligibleFrom:201}] }),
    /SURVIVORSHIP_BIAS:constituent_not_yet_eligible/,
  );
  assert.throws(
    () => validateResearchUniverseProvenance({ ...universe, constituents:[{...universe.constituents[0],eligibleUntil:200}] }),
    /SURVIVORSHIP_BIAS:constituent_not_eligible_as_of/,
  );
});

test("universe binds the exact historical dataset constituent and rejects survivor substitution", () => {
  assert.doesNotThrow(() => assertResearchUniverseDatasetBinding(universe,{
    market:"KRW-BTC",datasetId:"d-btc",datasetContentSha256:D,decisionAt:220
  }));
  assert.throws(() => assertResearchUniverseDatasetBinding(universe,{
    market:"KRW-XRP",datasetId:"d-xrp",datasetContentSha256:"d".repeat(64),decisionAt:220
  }),/UNIVERSE_DATASET_NOT_CONSTITUENT/);
  assert.throws(() => assertResearchUniverseDatasetBinding(universe,{
    market:"KRW-BTC",datasetId:"forged",datasetContentSha256:D,decisionAt:220
  }),/UNIVERSE_DATASET_BINDING_MISMATCH/);
});

test("universe replay rejects reconstructed membership drift", () => {
  const fp=researchUniverseFingerprint(universe);
  assert.doesNotThrow(() => assertResearchUniverseReplay(fp,universe));
  assert.throws(() => assertResearchUniverseReplay(fp,{
    ...universe,constituents:[universe.constituents[0]]
  }),/UNIVERSE_REPLAY_NON_DETERMINISTIC/);
});


test("universe fingerprint normalizes omitted versus undefined optional eligibility", () => {
  const withUndefined = {
    ...universe,
    constituents: universe.constituents.map((item) => ({ ...item, eligibleUntil: undefined })),
  };
  assert.equal(researchUniverseFingerprint(universe), researchUniverseFingerprint(withUndefined));
});

test("universe rejects non-canonical market identifiers before hashing", () => {
  assert.throws(
    () => researchUniverseFingerprint({ ...universe, constituents:[{...universe.constituents[0],market:"KRW-é"}] }),
    /INVALID_UNIVERSE_MARKET_ID/,
  );
});

test("universe dataset set must be available before evaluation and cover every evidence dataset", () => {
  const manifests = [
    { market:"KRW-BTC",datasetId:"d-btc",contentSha256:D,startOpenTime:200,endCloseTime:300 },
    { market:"KRW-ETH",datasetId:"d-eth",contentSha256:"c".repeat(64),startOpenTime:200,endCloseTime:300 },
  ];
  const historicalUniverse = { ...universe, asOf:200, availableAt:200 };
  assert.doesNotThrow(() => assertResearchUniverseDatasetSetBinding(historicalUniverse,manifests,{decisionAt:400}));
  assert.throws(
    () => assertResearchUniverseDatasetSetBinding({ ...historicalUniverse, asOf:201, availableAt:201 },manifests,{decisionAt:400}),
    /SURVIVORSHIP_BIAS:universe_snapshot_after_selection/,
  );
  assert.throws(
    () => assertResearchUniverseDatasetSetBinding(historicalUniverse,[manifests[0]],{decisionAt:400}),
    /UNIVERSE_DATASET_SET_MISMATCH/,
  );
  assert.throws(
    () => assertResearchUniverseDatasetSetBinding({
      ...historicalUniverse,
      constituents: historicalUniverse.constituents.map((item) => item.market === "KRW-ETH" ? {...item,datasetId:"forged"} : item),
    },manifests,{decisionAt:400}),
    /UNIVERSE_DATASET_BINDING_MISMATCH/,
  );
  assert.throws(
    () => assertResearchUniverseDatasetSetBinding({
      ...historicalUniverse,
      constituents: historicalUniverse.constituents.map((item) => item.market === "KRW-ETH" ? {...item,eligibleUntil:250} : item),
    },manifests,{decisionAt:400}),
    /SURVIVORSHIP_BIAS:constituent_not_eligible_for_full_period/,
  );
});

test("PIT universe fingerprint is deterministic across constituent order", () => {
  const base = {
    universeId:"upbit-eligible", universeVersion:"1", asOf:100, availableAt:110,
    eligibilityPolicyId:"eligible-v1", selectionPolicyId:"selection-v1",
    constituents:[
      {market:"KRW-BTC",datasetFingerprint:"c".repeat(64),listedAt:1},
      {market:"KRW-ETH",datasetFingerprint:"d".repeat(64),listedAt:2},
    ],
  };
  assert.equal(universeFingerprint(base,120), universeFingerprint({...base,constituents:[...base.constituents].reverse()},120));
});

test("current universe cannot be reused for a historical decision", () => {
  const universe = {
    universeId:"upbit-eligible", universeVersion:"1", asOf:200, availableAt:210,
    eligibilityPolicyId:"eligible-v1", selectionPolicyId:"selection-v1",
    constituents:[{market:"KRW-BTC",datasetFingerprint:"c".repeat(64),listedAt:1}],
  };
  assert.throws(() => universeFingerprint(universe,150), /FUTURE_LEAKAGE/);
});

test("survivorship-invalid constituents fail closed", () => {
  const base = {
    universeId:"upbit-eligible", universeVersion:"1", asOf:100, availableAt:110,
    eligibilityPolicyId:"eligible-v1", selectionPolicyId:"selection-v1",
  };
  assert.throws(() => universeFingerprint({...base,constituents:[{market:"KRW-NEW",datasetFingerprint:"c".repeat(64),listedAt:101}]},120), /SURVIVORSHIP_BIAS/);
  assert.throws(() => universeFingerprint({...base,constituents:[{market:"KRW-OLD",datasetFingerprint:"c".repeat(64),listedAt:1,delistedAt:90}]},120), /SURVIVORSHIP_BIAS/);
});

test("universe binding rejects constituent or policy mutation", () => {
  const universe = {
    universeId:"upbit-eligible", universeVersion:"1", asOf:100, availableAt:110,
    eligibilityPolicyId:"eligible-v1", selectionPolicyId:"selection-v1",
    constituents:[{market:"KRW-BTC",datasetFingerprint:"c".repeat(64),listedAt:1}],
  };
  const fp=universeFingerprint(universe,120);
  assert.doesNotThrow(() => assertUniverseBinding(universe,120,fp));
  assert.throws(() => assertUniverseBinding({...universe,selectionPolicyId:"selection-v2"},120,fp), /UNIVERSE_FINGERPRINT_MISMATCH/);
  assert.throws(() => assertUniverseBinding({...universe,constituents:[{...universe.constituents[0]!,datasetFingerprint:"d".repeat(64)}]},120,fp), /UNIVERSE_FINGERPRINT_MISMATCH/);
});
