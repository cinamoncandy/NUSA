import test from "node:test";
import assert from "node:assert/strict";
import {
  assertDeterministicReplay, assertFeatureBinding, assertSegmentIsolation, evidenceFingerprint,
  featureFingerprint, oosReuseFingerprint, validateEvidenceProvenance, validatePointInTimeBoundary
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
