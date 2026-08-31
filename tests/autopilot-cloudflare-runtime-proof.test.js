const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const script = fs.readFileSync(path.join(__dirname, "..", "scripts", "verify-autopilot-cloudflare-runtime.mjs"), "utf8");
const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "autopilot-cloudflare-runtime-proof.yml"), "utf8");

test("runtime proof runs hourly away from the scheduler burst and uploads bounded evidence", () => {
  assert.equal(workflow.includes("cron: '37 * * * *'"), true);
  assert.equal(workflow.includes("NUSA_RUNTIME_PROOF_OUTPUT"), true);
  assert.equal(workflow.includes("NUSA_RUNTIME_PROOF_EVENT"), true);
  assert.equal(workflow.includes("NUSA_RUNTIME_PROOF_RUN_ID"), true);
  assert.equal(workflow.includes("NUSA_RUNTIME_PROOF_SOURCE_SHA"), true);
  assert.equal(workflow.includes("name: Upload runtime proof evidence"), true);
  assert.equal(workflow.includes("if: always()"), true);
  assert.equal(workflow.includes("retention-days: 7"), true);
});

test("runtime proof distinguishes scheduler, receipt, and worker failures without exposing credentials", () => {
  for (const classification of ["proof_not_scheduled", "proof_scheduled_late", "worker_receipt_stale", "worker_unreachable", "proof_invalid"]) {
    assert.equal(script.includes('"' + classification + '"'), true, classification);
  }
  assert.equal(script.includes("schemaVersion: 2"), true);
  assert.equal(script.includes('liveAuthority: "NONE"'), true);
  assert.equal(script.includes("productionMutationAllowed: false"), true);
  assert.equal(script.includes('aiAuthority: "ZERO_AUTHORITY"'), true);
  for (const marker of ["proofId", "workerReceiptIdentity", "evidenceFingerprint", "HEAD_MISMATCH_FAILED_CLOSED", "auth_failed_closed", "MAX_TRANSIENT_ATTEMPTS"]) {
    assert.equal(script.includes(marker), true, marker);
  }
  assert.doesNotMatch(script, /Authorization|Bearer|cookie|secret/i);
});

function healthBody() {
  return {
    service: "nusa-autopilot",
    status: "WEBHOOK_READY",
    deploymentRevision: "revision-test",
    persistentExecutionCoordination: "CONFIGURED",
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  };
}

function scheduledBody(headSha, workflowRunId = 999) {
  const now = 1_700_000_000_000;
  return {
    status: "OBSERVED",
    receipt: {
      scheduledTime: now - 1_000,
      observedAt: now,
      status: "DUPLICATE_EXECUTION_SUPPRESSED",
      reason: "scheduled-state-unchanged",
      headSha,
      workflowRunId,
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    },
    history: [],
    summary: null,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  };
}

async function loadVerifier() {
  return import(pathToFileURL(path.join(__dirname, "..", "scripts", "verify-autopilot-cloudflare-runtime.mjs")).href);
}

function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fetchSequence({ headSha, transientScheduledFailures = 0, healthStatus = 200, scheduledPayload }) {
  let healthCalls = 0;
  let scheduledCalls = 0;
  return {
    get calls() { return { healthCalls, scheduledCalls }; },
    fetchImpl: async (url) => {
      if (url.endsWith("/health")) {
        healthCalls += 1;
        return response(healthStatus, healthBody());
      }
      scheduledCalls += 1;
      if (scheduledCalls <= transientScheduledFailures) return response(503, { error: "temporary" });
      return response(200, scheduledPayload ?? scheduledBody(headSha));
    },
  };
}

test("scheduled proof binds the actual workflow run and exact source head", async () => {
  const sourceSha = "a".repeat(40);
  const sequence = fetchSequence({ headSha: sourceSha });
  const verifier = await loadVerifier();
  const proof = await verifier.collectRuntimeProof({
    fetchImpl: sequence.fetchImpl,
    requestBaseUrl: "https://example.test",
    contextOverride: { workflowName: "Autopilot Cloudflare Runtime Proof", workflowRunId: 12345, workflowRunAttempt: 1, triggerType: "schedule", sourceBranch: "main", sourceSha },
    now: 1_700_000_000_500,
  });
  assert.equal(proof.proofStatus, "PROOF_FRESH");
  assert.equal(proof.workflowRunId, 12345);
  assert.equal(proof.workerReceiptWorkflowRunId, 999);
  assert.equal(proof.sourceSha, sourceSha);
  assert.equal(proof.expectedMainSha, sourceSha);
  assert.equal(proof.exactHeadVerified, true);
  assert.equal(typeof proof.proofId, "string");
  assert.equal(proof.proofId, proof.evidenceFingerprint);
  assert.deepEqual(sequence.calls, { healthCalls: 1, scheduledCalls: 1 });
});

test("runtime context preserves the workflow start timestamp when supplied as ISO evidence", async () => {
  const sourceSha = "a".repeat(40);
  const verifier = await loadVerifier();
  const previous = process.env.NUSA_RUNTIME_PROOF_STARTED_AT;
  process.env.NUSA_RUNTIME_PROOF_STARTED_AT = "2026-08-31T02:00:00.000Z";
  try {
    const proof = await verifier.collectRuntimeProof({
      fetchImpl: fetchSequence({ headSha: sourceSha }).fetchImpl,
      requestBaseUrl: "https://example.test",
      contextOverride: {
        workflowRunId: 12345,
        workflowRunAttempt: 1,
        triggerType: "schedule",
        sourceBranch: "main",
        sourceSha,
      },
      now: 1_700_000_000_500,
    });
    assert.equal(proof.actualStartTimestamp, Date.parse("2026-08-31T02:00:00.000Z"));
  } finally {
    if (previous === undefined) delete process.env.NUSA_RUNTIME_PROOF_STARTED_AT;
    else process.env.NUSA_RUNTIME_PROOF_STARTED_AT = previous;
  }
});

test("transient runtime failures retry only within the bounded budget", async () => {
  const sourceSha = "a".repeat(40);
  const sequence = fetchSequence({ headSha: sourceSha, transientScheduledFailures: 1 });
  const verifier = await loadVerifier();
  const proof = await verifier.collectRuntimeProof({
    fetchImpl: sequence.fetchImpl,
    requestBaseUrl: "https://example.test",
    contextOverride: { workflowRunId: 12345, workflowRunAttempt: 1, triggerType: "schedule", sourceBranch: "main", sourceSha },
    now: 1_700_000_000_500,
  });
  assert.equal(proof.proofStatus, "PROOF_FRESH");
  assert.deepEqual(sequence.calls, { healthCalls: 1, scheduledCalls: 2 });
});

test("a scheduled receipt from another head fails closed", async () => {
  const verifier = await loadVerifier();
  await assert.rejects(() => verifier.collectRuntimeProof({
    fetchImpl: fetchSequence({ headSha: "b".repeat(40) }).fetchImpl,
    requestBaseUrl: "https://example.test",
    contextOverride: { workflowRunId: 12345, workflowRunAttempt: 1, triggerType: "schedule", sourceBranch: "main", sourceSha: "a".repeat(40) },
    now: 1_700_000_000_500,
  }), (error) => error?.classification === "head_mismatch_failed_closed" && error?.reasonCode === "HEAD_MISMATCH_FAILED_CLOSED");
});

test("push verification cannot be counted as a scheduled proof", async () => {
  const sourceSha = "a".repeat(40);
  const verifier = await loadVerifier();
  const proof = await verifier.collectRuntimeProof({
    fetchImpl: fetchSequence({ headSha: sourceSha }).fetchImpl,
    requestBaseUrl: "https://example.test",
    contextOverride: { workflowRunId: 12345, workflowRunAttempt: 1, triggerType: "push", sourceBranch: "main", sourceSha },
    now: 1_700_000_000_500,
  });
  assert.equal(proof.proofStatus, "INSUFFICIENT_EVIDENCE");
  assert.equal(proof.exactHeadVerified, true);
});

test("missing scheduled evidence is classified as proof_not_scheduled", async () => {
  const sourceSha = "a".repeat(40);
  const sequence = fetchSequence({
    headSha: sourceSha,
    scheduledPayload: {
      status: "AWAITING_FIRST_SCHEDULED_EVENT",
      receipt: null,
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    },
  });
  const verifier = await loadVerifier();
  await assert.rejects(() => verifier.collectRuntimeProof({
    fetchImpl: sequence.fetchImpl,
    requestBaseUrl: "https://example.test",
    contextOverride: { workflowRunId: 12345, workflowRunAttempt: 1, triggerType: "schedule", sourceBranch: "main", sourceSha },
    now: 1_700_000_000_500,
  }), (error) => error?.classification === "proof_not_scheduled" && error?.reasonCode === "PROOF_NOT_SCHEDULED");
  assert.deepEqual(sequence.calls, { healthCalls: 1, scheduledCalls: 1 });
});

test("a scheduled receipt observed after its allowed schedule window is classified as proof_scheduled_late", async () => {
  const sourceSha = "a".repeat(40);
  const observedAt = 1_700_000_000_000;
  const sequence = fetchSequence({
    headSha: sourceSha,
    scheduledPayload: {
      status: "OBSERVED",
      receipt: {
        scheduledTime: observedAt - 180_001,
        observedAt,
        status: "DUPLICATE_EXECUTION_SUPPRESSED",
        reason: "scheduled-state-unchanged",
        headSha: sourceSha,
        workflowRunId: 999,
        liveAuthority: "NONE",
        productionMutationAllowed: false,
        aiAuthority: "ZERO_AUTHORITY",
      },
      history: [],
      summary: null,
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    },
  });
  const verifier = await loadVerifier();
  await assert.rejects(() => verifier.collectRuntimeProof({
    fetchImpl: sequence.fetchImpl,
    requestBaseUrl: "https://example.test",
    contextOverride: { workflowRunId: 12345, workflowRunAttempt: 1, triggerType: "schedule", sourceBranch: "main", sourceSha },
    now: observedAt + 500,
  }), (error) => error?.classification === "proof_scheduled_late" && error?.reasonCode === "PROOF_SCHEDULED_LATE");
  assert.deepEqual(sequence.calls, { healthCalls: 1, scheduledCalls: 1 });
});

test("authentication failures fail closed without retry", async () => {
  const verifier = await loadVerifier();
  const sequence = fetchSequence({ headSha: "a".repeat(40), healthStatus: 401 });
  await assert.rejects(() => verifier.collectRuntimeProof({
    fetchImpl: sequence.fetchImpl,
    requestBaseUrl: "https://example.test",
    contextOverride: { workflowRunId: 12345, workflowRunAttempt: 1, triggerType: "schedule", sourceBranch: "main", sourceSha: "a".repeat(40) },
    now: 1_700_000_000_500,
  }), (error) => error?.classification === "auth_failed_closed");
  assert.deepEqual(sequence.calls, { healthCalls: 1, scheduledCalls: 0 });
});

test("retry exhaustion remains bounded and stale receipts never pass", async () => {
  const verifier = await loadVerifier();
  const sequence = fetchSequence({ headSha: "a".repeat(40), transientScheduledFailures: 2 });
  await assert.rejects(() => verifier.collectRuntimeProof({
    fetchImpl: sequence.fetchImpl,
    requestBaseUrl: "https://example.test",
    contextOverride: { workflowRunId: 12345, workflowRunAttempt: 1, triggerType: "schedule", sourceBranch: "main", sourceSha: "a".repeat(40) },
    now: 1_700_000_000_500,
  }), (error) => error?.classification === "worker_unreachable" && error?.retryCount === 1);
  assert.deepEqual(sequence.calls, { healthCalls: 1, scheduledCalls: 2 });

  const staleSequence = fetchSequence({ headSha: "a".repeat(40) });
  await assert.rejects(() => verifier.collectRuntimeProof({
    fetchImpl: staleSequence.fetchImpl,
    requestBaseUrl: "https://example.test",
    contextOverride: { workflowRunId: 12345, workflowRunAttempt: 1, triggerType: "schedule", sourceBranch: "main", sourceSha: "a".repeat(40) },
    now: 1_700_000_200_000,
  }), (error) => error?.classification === "worker_receipt_stale");
});

