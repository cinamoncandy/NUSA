import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPaperChaosOperationalEvidence } from "./paperChaosEvidenceProvenance";
import { buildPaperChaosRecoveryReceipt } from "./paperChaosRecovery";
import {
  createPaperChaosGitHubRunLookup,
  PaperChaosGitHubRunLookupError,
  promotePaperChaosOperationalEvidenceFromGitHub,
  type PaperChaosGitHubRunResponse,
} from "./paperChaosGitHubRunLookup";

const REPOSITORY = "cinamoncandy/NUSA";
const SHA = "864274b9af824d8fdae1e0629c61596cc81155ea";
const RUN_ID = 33_150_000_000;
const WORKFLOW_REF = `${REPOSITORY}/.github/workflows/actual-paper-runtime.yml@refs/heads/support/882-paper-chaos-provenance`;
const RUN_URL = `https://github.com/${REPOSITORY}/actions/runs/${RUN_ID}`;
const TEST_TOKEN = ["test", "-token"].join("");

function state(overrides: Record<string, unknown> = {}) {
  return {
    runtimeStatus: "HALTED" as const,
    persistenceStatus: "AVAILABLE" as const,
    upstreamStatus: "DOWN" as const,
    chronologyStatus: "VALID" as const,
    reconciliationStatus: "MATCH" as const,
    orderIds: ["order-1"],
    fillIds: ["fill-1"],
    observedAt: 2_001,
    ...overrides,
  };
}

function boundEvidence() {
  const receipt = buildPaperChaosRecoveryReceipt({
    schemaVersion: 1,
    drillId: "runtime-upstream-outage",
    scenario: "UPSTREAM_OUTAGE",
    triggerObserved: true,
    before: state({ runtimeStatus: "RUNNING", upstreamStatus: "HEALTHY", observedAt: 2_000 }),
    after: state(),
  });
  return buildPaperChaosOperationalEvidence(receipt, {
    githubActions: "true",
    repository: REPOSITORY,
    sha: SHA,
    runId: String(RUN_ID),
    runAttempt: "1",
    workflowRef: WORKFLOW_REF,
    eventName: "pull_request",
    serverUrl: "https://github.com",
  });
}

function githubRun(overrides: Partial<PaperChaosGitHubRunResponse> = {}): PaperChaosGitHubRunResponse {
  return {
    id: RUN_ID,
    run_attempt: 1,
    head_sha: SHA,
    event: "pull_request",
    status: "completed",
    conclusion: "success",
    path: ".github/workflows/actual-paper-runtime.yml",
    head_branch: "support/882-paper-chaos-provenance",
    html_url: RUN_URL,
    repository: { full_name: REPOSITORY },
    ...overrides,
  };
}

function code(action: () => unknown): string {
  try { action(); } catch (error) {
    if (error instanceof PaperChaosGitHubRunLookupError) return error.code;
    throw error;
  }
  throw new Error("expected PaperChaosGitHubRunLookupError");
}

describe("paper chaos GitHub run lookup", () => {
  it("uses a read-only exact run lookup and promotes only the matching run", async () => {
    const requests: Array<{ url: string; method: string; authorization: string | undefined }> = [];
    const lookup = createPaperChaosGitHubRunLookup({
      token: TEST_TOKEN,
      fetchImpl: async (url, init) => {
        requests.push({ url, method: init.method, authorization: init.headers.Authorization });
        return { status: 200, json: async () => githubRun() };
      },
    });

    const verified = await promotePaperChaosOperationalEvidenceFromGitHub(boundEvidence(), lookup);
    assert.equal(verified.verificationStatus, "VERIFIED");
    assert.deepEqual(requests, [{
      url: `https://api.github.com/repos/${REPOSITORY}/actions/runs/${RUN_ID}`,
      method: "GET",
      authorization: `Bearer ${TEST_TOKEN}`,
    }]);
    assert.equal(JSON.stringify(verified).includes(TEST_TOKEN), false);
  });

  it("rejects a missing or unsuccessful remote run instead of trusting local-looking fields", async () => {
    const lookup = createPaperChaosGitHubRunLookup({
      token: TEST_TOKEN,
      fetchImpl: async () => ({ status: 404, json: async () => ({ message: "not found" }) }),
    });
    await assert.rejects(
      () => promotePaperChaosOperationalEvidenceFromGitHub(boundEvidence(), lookup),
      (error) => error instanceof PaperChaosGitHubRunLookupError && error.code === "RUN_NOT_FOUND",
    );

    for (const mismatch of [
      { head_sha: "b".repeat(40) },
      { event: "workflow_dispatch" },
      { status: "in_progress" },
      { conclusion: "failure" },
      { path: ".github/workflows/other.yml" },
      { head_branch: "other-branch" },
      { repository: { full_name: "other/repo" } },
    ] satisfies Array<Partial<PaperChaosGitHubRunResponse>>) {
      const mismatchLookup = createPaperChaosGitHubRunLookup({
        token: TEST_TOKEN,
        fetchImpl: async () => ({ status: 200, json: async () => githubRun(mismatch) }),
      });
      await assert.rejects(
        () => promotePaperChaosOperationalEvidenceFromGitHub(boundEvidence(), mismatchLookup),
        (error) => error instanceof PaperChaosGitHubRunLookupError,
      );
    }
  });

  it("fails closed when authentication is unavailable or response data is malformed", async () => {
    assert.equal(code(() => createPaperChaosGitHubRunLookup({ token: "" })), "INVALID_RESPONSE");
    const malformed = createPaperChaosGitHubRunLookup({
      token: TEST_TOKEN,
      fetchImpl: async () => ({ status: 200, json: async () => ({ id: RUN_ID }) }),
    });
    await assert.rejects(
      () => promotePaperChaosOperationalEvidenceFromGitHub(boundEvidence(), malformed),
      (error) => error instanceof PaperChaosGitHubRunLookupError && error.code === "INVALID_RESPONSE",
    );
  });
});
