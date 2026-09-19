import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateCanonicalComponentHealth } from "./canonicalComponentHealth";

const base = { component: "paper-market-data", now: 10_000, maximumAgeMs: 2_000, provenance: "market-event:abc" };

test("component health is deterministic and healthy for fresh evidence", () => {
  const a = evaluateCanonicalComponentHealth({ ...base, observedAt: 9_500 });
  const b = evaluateCanonicalComponentHealth({ ...base, observedAt: 9_500 });
  assert.equal(a.status, "HEALTHY");
  assert.equal(a.reason, "FRESH_EVIDENCE");
  assert.equal(a.fingerprintSha256, b.fingerprintSha256);
});

test("missing, stale, degraded, and failed evidence are classified fail-closed", () => {
  assert.equal(evaluateCanonicalComponentHealth({ ...base, observedAt: null }).status, "UNKNOWN");
  assert.equal(evaluateCanonicalComponentHealth({ ...base, observedAt: 7_999 }).status, "STALE");
  assert.equal(evaluateCanonicalComponentHealth({ ...base, observedAt: 9_500, degraded: true }).status, "DEGRADED");
  assert.equal(evaluateCanonicalComponentHealth({ ...base, observedAt: 9_500, failed: true }).status, "FAILED");
});

test("future and out-of-order evidence cannot become healthy", () => {
  assert.equal(evaluateCanonicalComponentHealth({ ...base, observedAt: 10_001 }).reason, "FUTURE_EVIDENCE");
  assert.equal(evaluateCanonicalComponentHealth({ ...base, observedAt: 9_000, previousObservedAt: 9_001 }).reason, "OUT_OF_ORDER_EVIDENCE");
});

test("recovery requires fresh evidence", () => {
  const stale = evaluateCanonicalComponentHealth({ ...base, observedAt: 7_000 });
  assert.equal(stale.status, "STALE");
  const recovered = evaluateCanonicalComponentHealth({ ...base, observedAt: 9_500 });
  assert.equal(recovered.status, "HEALTHY");
  assert.notEqual(stale.fingerprintSha256, recovered.fingerprintSha256);
});
