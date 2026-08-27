import test from "node:test";
import assert from "node:assert/strict";
import {
  computeNusaProgressScorecard,
  type NusaAcceptanceClass,
  type NusaProgressDomain,
  type NusaProgressEvidenceRef,
  type NusaProgressItemInput,
} from "./nusaProgressScorecard";
import { assessNusaProgressLevel } from "./nusaProgressLevel";

const AS_OF = 1_800_000_000_000;
const policy = { asOf: AS_OF, maximumEvidenceAgeMs: 60_000 };

function evidence(id: string, kind: NusaProgressEvidenceRef["kind"], status: NusaProgressEvidenceRef["status"] = "PASS", observedAt = AS_OF): NusaProgressEvidenceRef {
  return { id, kind, status, observedAt, source: `source:${id}` };
}

function proof(id: string, domain: NusaProgressDomain, acceptance: NusaAcceptanceClass, status: NusaProgressEvidenceRef["status"] = "PASS", observedAt = AS_OF): NusaProgressItemInput {
  const evidenceByAcceptance: Readonly<Record<NusaAcceptanceClass, readonly NusaProgressEvidenceRef[]>> = {
    CODE_COMPLETE: [evidence(`${id}-repo`, "REPOSITORY", status, observedAt), evidence(`${id}-ci`, "CI", status, observedAt)],
    RUNTIME_VERIFIED: [evidence(`${id}-runtime`, "RUNTIME", status, observedAt)],
    EVIDENCE_VERIFIED: [evidence(`${id}-paper`, "PAPER", status, observedAt)],
    PRODUCT_ACCEPTED: [evidence(`${id}-device`, "DEVICE", status, observedAt), evidence(`${id}-human`, "HUMAN", status, observedAt)],
    HUMAN_ONLY: [evidence(`${id}-human`, "HUMAN", status, observedAt)],
  };
  return { id, domain, weight: 1, requiredAcceptance: acceptance, evidence: evidenceByAcceptance[acceptance] };
}

const baseDomainItems = (): NusaProgressItemInput[] => [
  proof("edge-code", "VERIFIED_ECONOMIC_EDGE", "CODE_COMPLETE"),
  proof("autonomy-code", "AUTONOMY", "CODE_COMPLETE"),
  proof("recovery-code", "RELIABILITY_RECOVERY", "CODE_COMPLETE"),
  proof("safety-code", "SAFETY_RESEARCH_INTEGRITY", "CODE_COMPLETE"),
  proof("product-code", "PRODUCT_UX", "CODE_COMPLETE"),
  proof("infra-code", "INFRASTRUCTURE_MODULE_HEALTH", "CODE_COMPLETE"),
];

function level(items: readonly NusaProgressItemInput[]) {
  return assessNusaProgressLevel(computeNusaProgressScorecard(items, policy));
}

test("six-domain code coverage cannot masquerade as runtime verification", () => {
  const result = level(baseDomainItems());
  assert.equal(result.level, 4);
  assert.ok(result.blockedCriteria[0]?.startsWith("LV5_RUNTIME_EVIDENCE_PRESENT"));
});

test("runtime evidence advances only through the runtime criteria", () => {
  const result = level([
    ...baseDomainItems(),
    proof("runtime-general", "INFRASTRUCTURE_MODULE_HEALTH", "RUNTIME_VERIFIED"),
    proof("runtime-recovery", "RELIABILITY_RECOVERY", "RUNTIME_VERIFIED"),
  ]);
  assert.equal(result.level, 6);
  assert.ok(result.blockedCriteria[0]?.startsWith("LV7_ECONOMIC_EVIDENCE_VERIFIED"));
});

test("verified economic PAPER evidence with no failures reaches level 8 but not product acceptance", () => {
  const result = level([
    ...baseDomainItems(),
    proof("runtime-general", "INFRASTRUCTURE_MODULE_HEALTH", "RUNTIME_VERIFIED"),
    proof("runtime-recovery", "RELIABILITY_RECOVERY", "RUNTIME_VERIFIED"),
    proof("economic-paper", "VERIFIED_ECONOMIC_EDGE", "EVIDENCE_VERIFIED"),
  ]);
  assert.equal(result.level, 8);
  assert.ok(result.blockedCriteria[0]?.startsWith("LV9_PRODUCT_PHYSICALLY_ACCEPTED"));
});

test("physical device plus human product evidence is required for level 9", () => {
  const result = level([
    ...baseDomainItems(),
    proof("runtime-general", "INFRASTRUCTURE_MODULE_HEALTH", "RUNTIME_VERIFIED"),
    proof("runtime-recovery", "RELIABILITY_RECOVERY", "RUNTIME_VERIFIED"),
    proof("economic-paper", "VERIFIED_ECONOMIC_EDGE", "EVIDENCE_VERIFIED"),
    proof("galaxy-acceptance", "PRODUCT_UX", "PRODUCT_ACCEPTED"),
    proof("pending-extra-runtime", "AUTONOMY", "RUNTIME_VERIFIED", "UNKNOWN"),
  ]);
  assert.equal(result.level, 9);
  assert.ok(result.reasons.includes("UNKNOWN_EVIDENCE_BLOCKS_HIGHER_LEVEL"));
});

test("level 10 requires every configured item to pass", () => {
  const result = level([
    ...baseDomainItems(),
    proof("runtime-general", "INFRASTRUCTURE_MODULE_HEALTH", "RUNTIME_VERIFIED"),
    proof("runtime-recovery", "RELIABILITY_RECOVERY", "RUNTIME_VERIFIED"),
    proof("economic-paper", "VERIFIED_ECONOMIC_EDGE", "EVIDENCE_VERIFIED"),
    proof("galaxy-acceptance", "PRODUCT_UX", "PRODUCT_ACCEPTED"),
  ]);
  assert.equal(result.level, 10);
  assert.equal(result.blockedCriteria.length, 0);
});

test("fresh failed evidence demotes an otherwise high score below level 8", () => {
  const result = level([
    ...baseDomainItems(),
    proof("runtime-general", "INFRASTRUCTURE_MODULE_HEALTH", "RUNTIME_VERIFIED"),
    proof("runtime-recovery", "RELIABILITY_RECOVERY", "RUNTIME_VERIFIED"),
    proof("economic-paper", "VERIFIED_ECONOMIC_EDGE", "EVIDENCE_VERIFIED"),
    proof("reliability-regression", "RELIABILITY_RECOVERY", "RUNTIME_VERIFIED", "FAIL"),
    proof("galaxy-acceptance", "PRODUCT_UX", "PRODUCT_ACCEPTED"),
  ]);
  assert.equal(result.level, 7);
  assert.ok(result.reasons.includes("FAILED_EVIDENCE_DEMOTES_LEVEL"));
});

test("stale product evidence automatically demotes level 9 to level 8", () => {
  const stable = [
    ...baseDomainItems(),
    proof("runtime-general", "INFRASTRUCTURE_MODULE_HEALTH", "RUNTIME_VERIFIED"),
    proof("runtime-recovery", "RELIABILITY_RECOVERY", "RUNTIME_VERIFIED"),
    proof("economic-paper", "VERIFIED_ECONOMIC_EDGE", "EVIDENCE_VERIFIED"),
  ];
  const fresh = level([...stable, proof("galaxy-acceptance", "PRODUCT_UX", "PRODUCT_ACCEPTED"), proof("pending", "AUTONOMY", "RUNTIME_VERIFIED", "UNKNOWN")]);
  assert.equal(fresh.level, 9);

  const stale = level([...stable, proof("galaxy-acceptance", "PRODUCT_UX", "PRODUCT_ACCEPTED", "PASS", AS_OF - 60_001)]);
  assert.equal(stale.level, 8);
});

test("level projection is deterministic across input order", () => {
  const items = [
    ...baseDomainItems(),
    proof("runtime-general", "INFRASTRUCTURE_MODULE_HEALTH", "RUNTIME_VERIFIED"),
    proof("runtime-recovery", "RELIABILITY_RECOVERY", "RUNTIME_VERIFIED"),
    proof("economic-paper", "VERIFIED_ECONOMIC_EDGE", "EVIDENCE_VERIFIED"),
  ];
  assert.deepEqual(level(items), level([...items].reverse()));
});
