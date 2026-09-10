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

function capabilities(value = true): Readonly<Record<TenXSCapability, boolean>> {
  return Object.fromEntries(TEN_X_S_CAPABILITIES.map((capability) => [capability, value])) as Record<TenXSCapability, boolean>;
}

function evidence(overrides: Partial<TenXSCertificationEvidence> = {}): TenXSCertificationEvidence {
  return Object.freeze({
    stage: "RISK",
    level10Satisfied: true,
    capabilities: capabilities(),
    evidenceRefs: Object.freeze(["unit:test", "ci:validation"]),
    safetyBoundaryIntact: true,
    regressionFree: true,
    lastKnownGoodRef: "4fe488ebfc7706406a86f29185e4b110fb9abec4",
    ...overrides
  });
}

describe("10X-S canonical registry", () => {
  it("targets every canonical module at the single highest tier with real evidence paths", () => {
    validateCanonicalModuleRegistry10XS();
    assert.deepEqual(CANONICAL_MODULE_REGISTRY_10XS.map((definition) => definition.stage), [...MODULE_STAGE_ORDER]);
    assert.equal(CANONICAL_MODULE_REGISTRY_10XS.every((definition) => definition.targetTier === "10X-S"), true);
    for (const definition of CANONICAL_MODULE_REGISTRY_10XS) {
      assert.equal(existsSync(resolve(process.cwd(), definition.canonicalEntrypoint)), true, definition.canonicalEntrypoint);
      for (const ref of definition.tenXSEvidenceRefs) assert.equal(existsSync(resolve(process.cwd(), ref)), true, ref);
    }
  });
});

describe("10X-S evidence gate", () => {
  it("certifies only complete, regression-free evidence", () => {
    const result = evaluateTenXSCertification(evidence());
    assert.equal(result.status, "CERTIFIED");
    assert.equal(result.effectiveTier, "10X-S");
    assert.deepEqual(result.reasons, []);
  });

  it("demotes a module when a regression is detected", () => {
    const result = evaluateTenXSCertification(evidence({ regressionFree: false }));
    assert.equal(result.status, "DEMOTED");
    assert.equal(result.effectiveTier, "10X");
    assert.equal(result.reasons.includes("REGRESSION_DETECTED"), true);
  });

  it("quarantines a module when the safety boundary is not intact", () => {
    const result = evaluateTenXSCertification(evidence({ safetyBoundaryIntact: false }));
    assert.equal(result.status, "QUARANTINED");
    assert.equal(result.effectiveTier, "LEVEL_10");
    assert.equal(result.reasons.includes("SAFETY_BOUNDARY_FAILED"), true);
  });
});
