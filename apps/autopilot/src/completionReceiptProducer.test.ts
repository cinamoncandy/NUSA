import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCompletionReceiptEvidence, changesWorkerRuntime, observeWorkerRuntime } from "./completionReceiptProducer";
import { classifyAutopilotCompletion } from "./autopilotCompletionReceipt";
import { TRUSTED_RELEASE_AUTH_APP_ID, type GithubReleaseCompletionResolution } from "./githubReleaseCompletionResolver";
import type { CodingExecutionEvidence } from "./codingExecutionEvidence";

const HEAD = "a".repeat(40);
const MERGED = "c".repeat(40);

const coding = (overrides: Partial<CodingExecutionEvidence["outcome"]> = {}): CodingExecutionEvidence => ({
  schemaVersion: 1,
  evidenceId: "e1",
  recordedAtMs: 1,
  request: { repository: "cinamoncandy/NUSA", headSha: "b".repeat(40), workflowRunId: 9, executionId: "exec-1", dedupeKey: "dedupe-1" },
  outcome: { status: "EXECUTION_ACCEPTED", reason: null, backend: "github-actions-runner", checkpointId: null, workspaceVerified: true, proposalValidated: true, changedFiles: ["docs/x.md"], publisher: "github", branch: "b", commitSha: HEAD, pullRequestNumber: 7, pullRequestUrl: null, ...overrides },
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
});

const release = (overrides: Partial<GithubReleaseCompletionResolution> = {}): GithubReleaseCompletionResolution => ({
  status: "RELEASE_COMPLETE",
  reason: "canonical-release-proof-chain-complete",
  pullRequestNumber: 7,
  releaseWorkflowRunId: 1,
  expectedHeadSha: HEAD,
  expectedBaseSha: "d".repeat(40),
  mergedSha: MERGED,
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
  ...overrides,
});

const classify = (evidence: NonNullable<ReturnType<typeof buildCompletionReceiptEvidence>>) =>
  classifyAutopilotCompletion(evidence, { releaseAppId: TRUSTED_RELEASE_AUTH_APP_ID });

describe("buildCompletionReceiptEvidence", () => {
  it("produces evidence the classifier verifies when the release is complete and identities match (docs-only change)", () => {
    const evidence = buildCompletionReceiptEvidence(coding(), release(), null);
    assert.ok(evidence);
    assert.equal(classify(evidence).classification, "VERIFIED_USEFUL_COMPLETION");
  });

  it("returns null unless the release is complete", () => {
    for (const status of ["NOT_RELEASED", "CONVERGENCE_INCOMPLETE", "RELEASE_PROVENANCE_MISSING", "RELEASE_NOT_APPLICABLE"] as const) {
      assert.equal(buildCompletionReceiptEvidence(coding(), release({ status }), null), null, status);
    }
  });

  it("returns null when the coding evidence names a different pull request or commit", () => {
    assert.equal(buildCompletionReceiptEvidence(coding({ pullRequestNumber: 8 }), release(), null), null);
    assert.equal(buildCompletionReceiptEvidence(coding({ commitSha: "e".repeat(40) }), release(), null), null);
    assert.equal(buildCompletionReceiptEvidence(coding({ commitSha: null }), release(), null), null);
    assert.equal(buildCompletionReceiptEvidence(coding({ pullRequestNumber: null }), release(), null), null);
  });

  it("demands runtime verification only when the change touches Worker runtime inputs", () => {
    const workerChange = coding({ changedFiles: ["apps/autopilot/src/worker.ts"] });
    const unverified = buildCompletionReceiptEvidence(workerChange, release(), null);
    assert.ok(unverified);
    assert.equal(unverified.runtime.required, true);
    const unverifiedResult = classify(unverified);
    assert.equal(unverifiedResult.classification, "INCOMPLETE");
    assert.ok(unverifiedResult.missing.includes("runtime.verified"));
    const verified = buildCompletionReceiptEvidence(workerChange, release(), { deployedRevisionIsDescendantOfMerged: true, healthOk: true });
    assert.ok(verified);
    assert.equal(classify(verified).classification, "VERIFIED_USEFUL_COMPLETION");
  });

  it("ignores runtime observations for a change that does not need them", () => {
    const evidence = buildCompletionReceiptEvidence(coding(), release(), { deployedRevisionIsDescendantOfMerged: false, healthOk: false });
    assert.ok(evidence);
    assert.equal(evidence.runtime.required, false);
    assert.equal(classify(evidence).classification, "VERIFIED_USEFUL_COMPLETION");
  });
});

describe("changesWorkerRuntime", () => {
  it("matches the Worker runtime input scope", () => {
    assert.equal(changesWorkerRuntime(["apps/autopilot/src/a.ts"]), true);
    assert.equal(changesWorkerRuntime(["apps/cloud/src/ai/x.ts"]), true);
    assert.equal(changesWorkerRuntime(["packages/contracts/src/y.ts"]), true);
    assert.equal(changesWorkerRuntime(["pnpm-lock.yaml"]), true);
    assert.equal(changesWorkerRuntime(["docs/x.md", "apps/desktop/src/z.ts"]), false);
  });
});

describe("observeWorkerRuntime", () => {
  const config = { token: "t", allowedRepository: "cinamoncandy/NUSA" };
  const fake = (status: number, body: unknown): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  const DEPLOYED = "f".repeat(40);

  it("reports descendant for ahead or identical and not descendant otherwise", async () => {
    assert.deepEqual(await observeWorkerRuntime(DEPLOYED, MERGED, config, fake(200, { status: "ahead" })), { deployedRevisionIsDescendantOfMerged: true, healthOk: true });
    assert.equal((await observeWorkerRuntime(DEPLOYED, MERGED, config, fake(200, { status: "identical" })))?.deployedRevisionIsDescendantOfMerged, true);
    assert.equal((await observeWorkerRuntime(DEPLOYED, MERGED, config, fake(200, { status: "behind" })))?.deployedRevisionIsDescendantOfMerged, false);
    assert.equal((await observeWorkerRuntime(DEPLOYED, MERGED, config, fake(200, { status: "diverged" })))?.deployedRevisionIsDescendantOfMerged, false);
  });

  it("returns null instead of guessing when the lookup or inputs are unusable", async () => {
    assert.equal(await observeWorkerRuntime(DEPLOYED, MERGED, config, fake(404, {})), null);
    assert.equal(await observeWorkerRuntime(DEPLOYED, MERGED, config, (async () => { throw new Error("net"); }) as unknown as typeof fetch), null);
    assert.equal(await observeWorkerRuntime("UNVERIFIED", MERGED, config, fake(200, { status: "ahead" })), null);
    assert.equal(await observeWorkerRuntime(DEPLOYED, null, config, fake(200, { status: "ahead" })), null);
    assert.equal(await observeWorkerRuntime(DEPLOYED, MERGED, { allowedRepository: "cinamoncandy/NUSA" }, fake(200, { status: "ahead" })), null);
  });
});
