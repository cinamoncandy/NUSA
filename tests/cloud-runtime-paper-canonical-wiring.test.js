const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { startCloudRuntime } = require("../dist/apps/cloud/src/runtime.js");

const BASE = 1_800_000_000_000;
const HASH = "a".repeat(64);
const PLAN = {
  periodId: "runtime-canonical-period",
  periodIndex: 0,
  advisory: {
    schemaVersion: 1,
    generatedAt: new Date(BASE - 100).toISOString(),
    policy: { maximumCandidateWeight: 1, minimumEvidenceBreadth: 0, maximumCandidateCount: 5, maximumFamilyWeight: 1 },
    entries: [{ id: "candidate-a", familyId: "family-a", rank: 1, leagueScore: 1, evidenceBreadth: 1, researchWeight: 1, reasons: ["NO_EXECUTION_AUTHORITY"], sourceDatasetIds: ["dataset-a"] }],
    excludedCandidateIds: [],
    reasons: ["NO_EXECUTION_AUTHORITY"],
    provenance: { sourceDatasetIds: ["dataset-a"] },
  },
  candidateProvenance: [{ candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: HASH }],
  periodStartAt: BASE,
};

test("production runtime exposes the canonical PAPER period accessor and fails closed without a canonical account source", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-paper-canonical-runtime-"));
  let handle;
  try {
    handle = startCloudRuntime({
      NUSA_CLOUD_STATE_DB_PATH: join(directory, "state.sqlite"),
      NUSA_CLOUD_DASHBOARD_PORT: "42983",
      NUSA_CLOUD_DASHBOARD_TOKEN: "runtime-canonical-paper-test-token-0123456789",
      NUSA_CLOUD_UPBIT_PUBLIC_DATA: "false",
    });
    assert.throws(() => handle.openPaperRealizedPeriodFromCanonicalAccount(PLAN), (error) => error?.code === "CANONICAL_ACCOUNT_UNAVAILABLE");
    assert.equal(handle.listPaperRealizedPeriods().length, 0);
  } finally {
    if (handle) await handle.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});
