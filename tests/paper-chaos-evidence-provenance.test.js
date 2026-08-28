const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPaperChaosRecoveryReceipt } = require("../dist/apps/cloud/src/paperChaosRecovery.js");
const {
  buildPaperChaosOperationalEvidence,
  promotePaperChaosOperationalEvidence,
  verifyPaperChaosOperationalEvidence,
} = require("../dist/apps/cloud/src/paperChaosEvidenceProvenance.js");

const state = (overrides = {}) => ({
  runtimeStatus: "HALTED",
  persistenceStatus: "AVAILABLE",
  upstreamStatus: "DOWN",
  chronologyStatus: "VALID",
  reconciliationStatus: "MATCH",
  orderIds: ["order-1"],
  fillIds: ["fill-1"],
  observedAt: 2_001,
  ...overrides,
});

const receipt = () => buildPaperChaosRecoveryReceipt({
  schemaVersion: 1,
  drillId: "runtime-upstream-outage",
  scenario: "UPSTREAM_OUTAGE",
  triggerObserved: true,
  before: state({ runtimeStatus: "RUNNING", upstreamStatus: "HEALTHY", observedAt: 2_000 }),
  after: state(),
});

const context = (overrides = {}) => ({
  githubActions: "true",
  repository: "cinamoncandy/NUSA",
  sha: "864274b9af824d8fdae1e0629c61596cc81155ea",
  runId: "33150000000",
  runAttempt: "1",
  workflowRef: "cinamoncandy/NUSA/.github/workflows/actual-paper-runtime.yml@refs/heads/support/882-paper-chaos-provenance",
  eventName: "pull_request",
  serverUrl: "https://github.com",
  ...overrides,
});

const trustedRun = (overrides = {}) => ({
  verificationSource: "GITHUB_API",
  repository: "cinamoncandy/NUSA",
  headSha: "864274b9af824d8fdae1e0629c61596cc81155ea",
  workflowRunId: 33150000000,
  workflowRunAttempt: 1,
  workflowRef: "cinamoncandy/NUSA/.github/workflows/actual-paper-runtime.yml@refs/heads/support/882-paper-chaos-provenance",
  eventName: "pull_request",
  workflowRunUrl: "https://github.com/cinamoncandy/NUSA/actions/runs/33150000000",
  ...overrides,
});

test("Actions context binds PAPER receipt but cannot self-promote to VERIFIED", () => {
  const evidence = buildPaperChaosOperationalEvidence(receipt(), context());
  assert.equal(evidence.verificationStatus, "BOUND_UNVERIFIED");
  assert.equal(evidence.repository, "cinamoncandy/NUSA");
  assert.equal(evidence.sourceSha, "864274b9af824d8fdae1e0629c61596cc81155ea");
  assert.equal(evidence.workflowRunId, 33150000000);
  assert.equal(evidence.workflowRunUrl, "https://github.com/cinamoncandy/NUSA/actions/runs/33150000000");
  assert.match(evidence.provenanceSha256, /^[a-f0-9]{64}$/);
  assert.throws(() => verifyPaperChaosOperationalEvidence(evidence), /NOT_VERIFIED/);
});

test("trusted GitHub run lookup promotes an exact binding to VERIFIED evidence", () => {
  const bound = buildPaperChaosOperationalEvidence(receipt(), context());
  const evidence = promotePaperChaosOperationalEvidence(bound, trustedRun());
  assert.equal(evidence.verificationStatus, "VERIFIED");
  assert.deepEqual(verifyPaperChaosOperationalEvidence(evidence), evidence);
});

test("well-formed fabricated or mismatched GitHub run identity cannot become VERIFIED", () => {
  const bound = buildPaperChaosOperationalEvidence(receipt(), context());
  const mismatches = [
    { workflowRunId: 33150000001 },
    { workflowRunAttempt: 2 },
    { headSha: "b".repeat(40) },
    { repository: "other/repo" },
    { eventName: "workflow_dispatch" },
    { workflowRef: "cinamoncandy/NUSA/.github/workflows/other.yml@refs/heads/support/882-paper-chaos-provenance" },
    { workflowRunUrl: "https://github.com/cinamoncandy/NUSA/actions/runs/33150000001" },
  ];
  for (const mismatch of mismatches) {
    assert.throws(
      () => promotePaperChaosOperationalEvidence(bound, trustedRun(mismatch)),
      /TRUSTED_RUN_MISMATCH/,
    );
  }
});

test("self-attested or incomplete contexts cannot even be bound", () => {
  const paperReceipt = receipt();
  assert.throws(() => buildPaperChaosOperationalEvidence(paperReceipt, context({ githubActions: "false" })), /NOT_GITHUB_ACTIONS/);
  assert.throws(() => buildPaperChaosOperationalEvidence(paperReceipt, context({ runId: "fake" })), /RUN_ID_INVALID/);
  assert.throws(() => buildPaperChaosOperationalEvidence(paperReceipt, context({ sha: "a".repeat(64) })), /SHA_INVALID/);
  assert.throws(() => buildPaperChaosOperationalEvidence(paperReceipt, context({ repository: "other/repo" })), /WORKFLOW_REF_INVALID/);
  assert.throws(() => buildPaperChaosOperationalEvidence(paperReceipt, context({ serverUrl: "https://example.com" })), /SERVER_INVALID/);
});

test("tampered verified provenance fails closed", () => {
  const evidence = promotePaperChaosOperationalEvidence(
    buildPaperChaosOperationalEvidence(receipt(), context()),
    trustedRun(),
  );
  assert.throws(
    () => verifyPaperChaosOperationalEvidence({ ...evidence, workflowRunId: evidence.workflowRunId + 1 }),
    /CONTENT_INVALID|INTEGRITY_FAILED/,
  );
  assert.throws(
    () => verifyPaperChaosOperationalEvidence({ ...evidence, eventName: "workflow_dispatch" }),
    /INTEGRITY_FAILED/,
  );
});
