import test from "node:test";
import assert from "node:assert/strict";
import {
  computeNusaProgressScorecard,
  NusaProgressScorecardError,
  type NusaProgressEvidenceRef,
  type NusaProgressItemInput,
} from "./nusaProgressScorecard";

const AS_OF = 1_800_000_000_000;
const SOURCE_FINGERPRINT = "a".repeat(64);
const PRODUCT_FINGERPRINT = "b".repeat(64);
const OTHER_PRODUCT_FINGERPRINT = "c".repeat(64);
const sourceFor = (kind: NusaProgressEvidenceRef["kind"], id: string): string => ({
  REPOSITORY: `github://commit/${id}`,
  CI: `github://actions/run/${id}`,
  RUNTIME: `runtime://evidence/${id}`,
  PAPER: `paper://evidence/${id}`,
  DEVICE: `device://physical/${id}`,
  HUMAN: `human://acceptance/${id}`,
  MOCK: `mock://fixture/${id}`,
})[kind];

const evidence = (
  id: string,
  kind: NusaProgressEvidenceRef["kind"],
  status: NusaProgressEvidenceRef["status"] = "PASS",
  observedAt = AS_OF,
  subjectFingerprint?: string,
): NusaProgressEvidenceRef => ({
  id,
  kind,
  status,
  observedAt,
  source: sourceFor(kind, id),
  sourceFingerprint: SOURCE_FINGERPRINT,
  ...(subjectFingerprint == null ? {} : { subjectFingerprint }),
});

const item = (overrides: Partial<NusaProgressItemInput> = {}): NusaProgressItemInput => ({
  id: "edge-runtime",
  domain: "VERIFIED_ECONOMIC_EDGE",
  weight: 1,
  requiredAcceptance: "RUNTIME_VERIFIED",
  evidence: [evidence("runtime-pass", "RUNTIME")],
  ...overrides,
});

const policy = { asOf: AS_OF, maximumEvidenceAgeMs: 60_000 };

test("runtime verification requires runtime evidence rather than CI or mock pass", () => {
  const scorecard = computeNusaProgressScorecard([
    item({ evidence: [evidence("ci", "CI"), evidence("mock", "MOCK")] }),
  ], policy);
  assert.equal(scorecard.items[0]?.status, "UNKNOWN");
  assert.ok(scorecard.items[0]?.reasons.includes("MISSING_RUNTIME_EVIDENCE"));
  assert.ok(scorecard.items[0]?.reasons.includes("MOCK_EVIDENCE_NON_ACCEPTING"));
  assert.equal(scorecard.overallProgressRatio, 0);
});

test("code complete requires both repository and CI evidence", () => {
  const partial = computeNusaProgressScorecard([
    item({ id: "code", requiredAcceptance: "CODE_COMPLETE", evidence: [evidence("repo", "REPOSITORY")] }),
  ], policy);
  assert.equal(partial.items[0]?.status, "UNKNOWN");
  assert.ok(partial.items[0]?.reasons.includes("MISSING_CI_EVIDENCE"));

  const complete = computeNusaProgressScorecard([
    item({ id: "code", requiredAcceptance: "CODE_COMPLETE", evidence: [evidence("repo", "REPOSITORY"), evidence("ci", "CI")] }),
  ], policy);
  assert.equal(complete.items[0]?.status, "PASS");
  assert.deepEqual(complete.items[0]?.acceptedEvidenceIds, ["ci", "repo"]);
});

test("PAPER evidence cannot masquerade as runtime or product acceptance", () => {
  const runtime = computeNusaProgressScorecard([
    item({ id: "runtime", evidence: [evidence("paper", "PAPER")] }),
  ], policy);
  assert.equal(runtime.items[0]?.status, "UNKNOWN");

  const product = computeNusaProgressScorecard([
    item({ id: "product", domain: "PRODUCT_UX", requiredAcceptance: "PRODUCT_ACCEPTED", evidence: [evidence("paper", "PAPER")] }),
  ], policy);
  assert.equal(product.items[0]?.status, "UNKNOWN");
  assert.ok(product.items[0]?.reasons.includes("MISSING_DEVICE_EVIDENCE"));
  assert.ok(product.items[0]?.reasons.includes("MISSING_HUMAN_EVIDENCE"));
});

test("product acceptance requires physical-device and human evidence bound to the same artifact", () => {
  const scorecard = computeNusaProgressScorecard([
    item({
      id: "galaxy-home",
      domain: "PRODUCT_UX",
      requiredAcceptance: "PRODUCT_ACCEPTED",
      evidence: [evidence("galaxy", "DEVICE", "PASS", AS_OF, PRODUCT_FINGERPRINT), evidence("owner", "HUMAN", "PASS", AS_OF, PRODUCT_FINGERPRINT)],
    }),
  ], policy);
  assert.equal(scorecard.items[0]?.status, "PASS");
});

test("human acceptance for a different APK cannot complete product acceptance", () => {
  const scorecard = computeNusaProgressScorecard([
    item({
      id: "galaxy-home",
      domain: "PRODUCT_UX",
      requiredAcceptance: "PRODUCT_ACCEPTED",
      evidence: [evidence("galaxy", "DEVICE", "PASS", AS_OF, PRODUCT_FINGERPRINT), evidence("owner", "HUMAN", "PASS", AS_OF, OTHER_PRODUCT_FINGERPRINT)],
    }),
  ], policy);
  assert.equal(scorecard.items[0]?.status, "UNKNOWN");
  assert.ok(scorecard.items[0]?.reasons.includes("PRODUCT_EVIDENCE_SUBJECT_MISMATCH"));
  assert.equal(scorecard.overallProgressRatio, 0);
});

test("evidence source scheme must match its declared evidence kind", () => {
  assert.throws(
    () => computeNusaProgressScorecard([item({ evidence: [{ ...evidence("runtime", "RUNTIME"), source: "github://actions/run/123" }] })], policy),
    (error: unknown) => error instanceof NusaProgressScorecardError && error.code === "EVIDENCE_SOURCE_KIND_MISMATCH",
  );
});

test("evidence receipts require immutable SHA-256 fingerprints", () => {
  assert.throws(
    () => computeNusaProgressScorecard([item({ evidence: [{ ...evidence("runtime", "RUNTIME"), sourceFingerprint: "not-a-digest" }] })], policy),
    (error: unknown) => error instanceof NusaProgressScorecardError && error.code === "INVALID_EVIDENCE_FINGERPRINT",
  );
});

test("human-only gates never pass from machine evidence", () => {
  const scorecard = computeNusaProgressScorecard([
    item({ id: "activation", requiredAcceptance: "HUMAN_ONLY", evidence: [evidence("ci", "CI"), evidence("runtime", "RUNTIME")] }),
  ], policy);
  assert.equal(scorecard.items[0]?.status, "UNKNOWN");
  assert.ok(scorecard.items[0]?.reasons.includes("MISSING_HUMAN_EVIDENCE"));
});

test("stale evidence loses credit instead of preserving an inflated score", () => {
  const fresh = computeNusaProgressScorecard([item()], policy);
  assert.equal(fresh.items[0]?.status, "PASS");
  assert.ok(fresh.overallProgressRatio > 0);

  const stale = computeNusaProgressScorecard([
    item({ evidence: [evidence("runtime-pass", "RUNTIME", "PASS", AS_OF - 60_001)] }),
  ], policy);
  assert.equal(stale.items[0]?.status, "UNKNOWN");
  assert.equal(stale.overallProgressRatio, 0);
  assert.ok(stale.items[0]?.reasons.includes("STALE_EVIDENCE_PRESENT"));
});

test("a fresh failure demotes the item even when another pass exists", () => {
  const scorecard = computeNusaProgressScorecard([
    item({ evidence: [evidence("runtime-pass", "RUNTIME"), evidence("runtime-fail", "RUNTIME", "FAIL")] }),
  ], policy);
  assert.equal(scorecard.items[0]?.status, "FAIL");
  assert.ok(scorecard.reasons.includes("FAILED_EVIDENCE_PRESENT"));
  assert.equal(scorecard.overallProgressRatio, 0);
});

test("future-derived evidence fails closed", () => {
  assert.throws(
    () => computeNusaProgressScorecard([
      item({ evidence: [evidence("future", "RUNTIME", "PASS", AS_OF + 1)] }),
    ], policy),
    (error: unknown) => error instanceof NusaProgressScorecardError && error.code === "INVALID_EVIDENCE_TIMESTAMP",
  );
});

test("domain weights must remain normalized", () => {
  assert.throws(
    () => computeNusaProgressScorecard([item()], { ...policy, domainWeights: { PRODUCT_UX: 0.5 } }),
    (error: unknown) => error instanceof NusaProgressScorecardError && error.code === "DOMAIN_WEIGHTS_NOT_NORMALIZED",
  );
});

test("recomputation is deterministic and input ordering does not change the score", () => {
  const items: NusaProgressItemInput[] = [
    item({ id: "runtime-a" }),
    item({ id: "safety-code", domain: "SAFETY_RESEARCH_INTEGRITY", requiredAcceptance: "CODE_COMPLETE", evidence: [evidence("repo", "REPOSITORY"), evidence("ci", "CI")] }),
  ];
  const forward = computeNusaProgressScorecard(items, policy);
  const reversed = computeNusaProgressScorecard([...items].reverse(), policy);
  assert.equal(forward.overallProgressRatio, reversed.overallProgressRatio);
  const key = (scorecard: typeof forward) => [...scorecard.items].map((entry) => [entry.id, entry.status]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  assert.deepEqual(key(forward), key(reversed));
});
