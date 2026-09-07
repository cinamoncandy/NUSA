import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildObservation } from "./observe-ci-stale-head.mjs";

const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);

function run(overrides = {}) {
  return {
    id: overrides.id ?? 123,
    event: "pull_request",
    status: "completed",
    conclusion: "success",
    pull_requests: overrides.pull_requests ?? [{ number: 42, head: { sha: HEAD_A } }],
  };
}

describe("CI stale-head observer", () => {
  it("measures exact-head completion from real workflow provenance", () => {
    const result = buildObservation({ run: run(), currentHeadSha: HEAD_A, observedAt: 1_000 });
    assert.equal(result.status, "MEASURED");
    assert.equal(result.observation.classification, "EXACT_HEAD_READY");
    assert.equal(result.observation.workflowHeadSha, HEAD_A);
    assert.match(result.observation.sourceFingerprint, /^[a-f0-9]{64}$/);
  });

  it("detects PR head movement during CI", () => {
    const result = buildObservation({ run: run(), currentHeadSha: HEAD_B, observedAt: 1_001 });
    assert.equal(result.status, "MEASURED");
    assert.equal(result.observation.classification, "STALE_HEAD_REVALIDATION_REQUIRED");
    assert.equal(result.observation.validatedHeadSha, HEAD_A);
    assert.equal(result.observation.currentHeadSha, HEAD_B);
  });

  it("fails closed when PR provenance is absent or ambiguous", () => {
    assert.deepEqual(buildObservation({ run: run({ pull_requests: [] }), currentHeadSha: HEAD_A, observedAt: 1_000 }), { status: "UNKNOWN", reason: "PULL_REQUEST_PROVENANCE_UNAVAILABLE" });
    assert.deepEqual(buildObservation({ run: run({ pull_requests: [{ number: 1, head: { sha: HEAD_A } }, { number: 2, head: { sha: HEAD_A } }] }), currentHeadSha: HEAD_A, observedAt: 1_000 }), { status: "UNKNOWN", reason: "PULL_REQUEST_PROVENANCE_UNAVAILABLE" });
  });

  it("fails closed on invalid run or head provenance", () => {
    assert.equal(buildObservation({ run: run({ id: 0 }), currentHeadSha: HEAD_A, observedAt: 1_000 }).status, "UNKNOWN");
    assert.equal(buildObservation({ run: run(), currentHeadSha: "short", observedAt: 1_000 }).status, "UNKNOWN");
    assert.equal(buildObservation({ run: run(), currentHeadSha: HEAD_A, observedAt: -1 }).status, "UNKNOWN");
  });

  it("fingerprints immutable source fields deterministically", () => {
    const first = buildObservation({ run: run(), currentHeadSha: HEAD_A, observedAt: 1_000 });
    const second = buildObservation({ run: run(), currentHeadSha: HEAD_A, observedAt: 2_000 });
    assert.equal(first.observation.sourceFingerprint, second.observation.sourceFingerprint);
    assert.notEqual(first.observation.sourceFingerprint, buildObservation({ run: run(), currentHeadSha: HEAD_B, observedAt: 1_000 }).observation.sourceFingerprint);
  });
});
