import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { CANONICAL_MODULE_REGISTRY_10XS, validateCanonicalModuleRegistry10XS } from "./canonicalModuleRegistryV10";
import { MODULE_STAGE_ORDER } from "./moduleLevel10";
import {
  TEN_X_S_CAPABILITIES,
  evaluateTenXSCertification,
  type TenXSCapability,
  type TenXSCertificationEvidence
} from "./module10XS";

const SOURCE_SHA = "1d538db896e9db58f925ebade464f2d8be7ae13e";
const EVIDENCE_SHA = "a".repeat(64);

function capabilities(value = true): Readonly<Record<TenXSCapability, boolean>> {
  return Object.fromEntries(TEN_X_S_CAPABILITIES.map((capability) => [capability, value])) as Record<TenXSCapability, boolean>;
}

function evidence(overrides: Partial<TenXSCertificationEvidence> = {}): TenXSCertificationEvidence {
  return Object.freeze({
    stage: "RISK",
    level10Satisfied: true,
    capabilities: capabilities(),
    evidenceRefs: Object.freeze(["unit:test", "integration:test", "ci:validation"]),
    safetyBoundaryIntact: true,
    regressionFree: true,
    lastKnownGoodRef: SOURCE_SHA,
    operational: Object.freeze({
      sourceCommitSha: SOURCE_SHA,
      evidenceFingerprint: EVIDENCE_SHA,
      deterministicReplayPassed: true,
      shadowComparisonPassed: true,
      recoveryDrillPassed: true,
      regressionBudgetPassed: true
    }),
    ...overrides
  });
}

describe("10X-S canonical registry", () => {
  it("targets every canonical module at the single highest tier with real canonical/runtime evidence paths", () => {
    validateCanonicalModuleRegistry10XS();
    assert.deepEqual(CANONICAL_MODULE_REGISTRY_10XS.map((definition) => definition.stage), [...MODULE_STAGE_ORDER]);
    assert.equal(CANONICAL_MODULE_REGISTRY_10XS.every((definition) => definition.targetTier === "10X-S"), true);
    for (const definition of CANONICAL_MODULE_REGISTRY_10XS) {
      assert.equal(existsSync(resolve(process.cwd(), definition.canonicalEntrypoint)), true, definition.canonicalEntrypoint);
      assert.equal(existsSync(resolve(process.cwd(), definition.runtimeEntrypoint)), true, definition.runtimeEntrypoint);
      assert.match(definition.rollbackRef, /^[0-9a-f]{40}$/);
      for (const ref of definition.tenXSEvidenceRefs) assert.equal(existsSync(resolve(process.cwd(), ref)), true, ref);
    }
  });
});

describe("10X-S evidence gate", () => {
  it("certifies only complete operational, regression-free evidence", () => {
    const result = evaluateTenXSCertification(evidence());
    assert.equal(result.status, "CERTIFIED");
    assert.equal(result.effectiveTier, "10X-S");
    assert.equal(result.evidenceFingerprint, EVIDENCE_SHA);
    assert.deepEqual(result.reasons, []);
  });

  it("demotes a module when a regression is detected", () => {
    const result = evaluateTenXSCertification(evidence({ regressionFree: false }));
    assert.equal(result.status, "DEMOTED");
    assert.equal(result.effectiveTier, "10X");
    assert.equal(result.reasons.includes("REGRESSION_DETECTED"), true);
  });

  it("demotes when deterministic replay or shadow comparison fails", () => {
    const result = evaluateTenXSCertification(evidence({
      operational: Object.freeze({
        sourceCommitSha: SOURCE_SHA,
        evidenceFingerprint: EVIDENCE_SHA,
        deterministicReplayPassed: false,
        shadowComparisonPassed: false,
        recoveryDrillPassed: true,
        regressionBudgetPassed: true
      })
    }));
    assert.equal(result.status, "DEMOTED");
    assert.equal(result.reasons.includes("DETERMINISTIC_REPLAY_FAILED"), true);
    assert.equal(result.reasons.includes("SHADOW_COMPARISON_FAILED"), true);
  });

  it("quarantines a module when the safety boundary or evidence identity is invalid", () => {
    const safety = evaluateTenXSCertification(evidence({ safetyBoundaryIntact: false }));
    assert.equal(safety.status, "QUARANTINED");
    assert.equal(safety.effectiveTier, "LEVEL_10");
    assert.equal(safety.reasons.includes("SAFETY_BOUNDARY_FAILED"), true);

    const identity = evaluateTenXSCertification(evidence({
      operational: Object.freeze({
        sourceCommitSha: "invalid",
        evidenceFingerprint: "invalid",
        deterministicReplayPassed: true,
        shadowComparisonPassed: true,
        recoveryDrillPassed: true,
        regressionBudgetPassed: true
      })
    }));
    assert.equal(identity.status, "QUARANTINED");
    assert.equal(identity.reasons.includes("SOURCE_COMMIT_INVALID"), true);
    assert.equal(identity.reasons.includes("EVIDENCE_FINGERPRINT_INVALID"), true);
  });
});
