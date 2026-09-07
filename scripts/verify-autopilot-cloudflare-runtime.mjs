#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const baseUrl = (process.env.NUSA_AUTOPILOT_URL ?? process.argv[2] ?? "").trim().replace(/\/$/, "");
const maxReceiptAgeMs = Number(process.env.NUSA_AUTOPILOT_MAX_RECEIPT_AGE_MS ?? 180000);
const proofOutputPath = (process.env.NUSA_RUNTIME_PROOF_OUTPUT ?? "").trim();
const MAX_TRANSIENT_ATTEMPTS = 2;
const SHA_40 = /^[0-9a-f]{40}$/i;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function hashCanonical(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function timestamp(value) {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  const parsed = Date.parse(String(value ?? ""));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function runtimeContext(overrides = {}) {
  const sourceShaValue = process.env.NUSA_RUNTIME_PROOF_SOURCE_SHA?.trim() || process.env.GITHUB_SHA?.trim() || "";
  return {
    workflowName: process.env.GITHUB_WORKFLOW?.trim() || "Autopilot Cloudflare Runtime Proof",
    workflowRunId: positiveInteger(process.env.NUSA_RUNTIME_PROOF_RUN_ID || process.env.GITHUB_RUN_ID),
    workflowRunAttempt: positiveInteger(process.env.NUSA_RUNTIME_PROOF_RUN_ATTEMPT || process.env.GITHUB_RUN_ATTEMPT) ?? 1,
    triggerType: process.env.NUSA_RUNTIME_PROOF_EVENT?.trim() || process.env.GITHUB_EVENT_NAME?.trim() || "unknown",
    sourceBranch: process.env.NUSA_RUNTIME_PROOF_SOURCE_BRANCH?.trim() || process.env.GITHUB_REF_NAME?.trim() || null,
    sourceSha: SHA_40.test(sourceShaValue) ? sourceShaValue.toLowerCase() : null,
    actualStartTimestamp: timestamp(process.env.NUSA_RUNTIME_PROOF_STARTED_AT || process.env.GITHUB_RUN_STARTED_AT),
    ...overrides,
  };
}

function proofFailureContext(error) {
  const context = runtimeContext();
  return {
    workflow: context.workflowName,
    workflowRunId: context.workflowRunId,
    workflowRunAttempt: context.workflowRunAttempt,
    triggerType: context.triggerType,
    sourceBranch: context.sourceBranch,
    sourceSha: context.sourceSha,
    actualStartTimestamp: context.actualStartTimestamp,
    retryCount: error instanceof RuntimeProofFailure ? error.retryCount : 0,
  };
}

class RuntimeProofFailure extends Error {
  constructor(classification, reasonCode, endpoint, retryCount = 0) {
    super(reasonCode);
    this.name = "RuntimeProofFailure";
    this.classification = classification;
    this.reasonCode = reasonCode;
    this.endpoint = endpoint;
    this.retryCount = retryCount;
  }
}

function writeProofEvidence(evidence) {
  if (!proofOutputPath) return;
  try {
    mkdirSync(dirname(proofOutputPath), { recursive: true });
    writeFileSync(proofOutputPath, JSON.stringify(evidence) + "\n", "utf8");
  } catch {
    console.error("CLOUDFLARE_RUNTIME_PROOF_EVIDENCE_WRITE_FAILED");
  }
}

function fail(error) {
  const proofFailure = error instanceof RuntimeProofFailure;
  const classification = proofFailure ? error.classification : "proof_invalid";
  const reasonCode = proofFailure ? error.reasonCode : error instanceof Error ? error.message : "PROOF_VALIDATION_FAILED";
  const endpoint = proofFailure ? error.endpoint : null;
  writeProofEvidence({
    schemaVersion: 2,
    status: "FAIL",
    classification,
    reasonCode,
    endpoint,
    checkedAt: Date.now(),
    ...proofFailureContext(error),
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY"
  });
  console.error("CLOUDFLARE_RUNTIME_PROOF_FAILED:" + classification + ":" + reasonCode);
  process.exitCode = 1;
}

function assertSafety(body, label) {
  if (!body || typeof body !== "object") throw new Error(label + "_BODY_INVALID");
  if (body.liveAuthority !== "NONE") throw new Error(label + "_LIVE_AUTHORITY_INVALID");
  if (body.productionMutationAllowed !== false) throw new Error(label + "_PRODUCTION_MUTATION_INVALID");
  if (body.aiAuthority !== "ZERO_AUTHORITY") throw new Error(label + "_AI_AUTHORITY_INVALID");
}

async function readJson(path, fetchImpl = fetch, requestBaseUrl = baseUrl) {
  for (let attempt = 1; attempt <= MAX_TRANSIENT_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(requestBaseUrl + path, { headers: { accept: "application/json" } });
    } catch {
      if (attempt < MAX_TRANSIENT_ATTEMPTS) continue;
      throw new RuntimeProofFailure("worker_unreachable", "WORKER_UNREACHABLE", path, attempt - 1);
    }
    let responseText;
    try {
      responseText = await response.text();
    } catch {
      if (attempt < MAX_TRANSIENT_ATTEMPTS) continue;
      throw new RuntimeProofFailure("worker_unreachable", "WORKER_RESPONSE_UNREADABLE", path, attempt - 1);
    }
    let body;
    try {
      body = JSON.parse(responseText);
    } catch {
      throw new RuntimeProofFailure("proof_invalid", path + "_NON_JSON_RESPONSE", path);
    }
    if (response.status === 401 || response.status === 403) {
      throw new RuntimeProofFailure("auth_failed_closed", path + "_AUTH_FAILED", path);
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt < MAX_TRANSIENT_ATTEMPTS) continue;
      throw new RuntimeProofFailure("worker_unreachable", path + "_HTTP_" + response.status, path, attempt - 1);
    }
    if (!response.ok) throw new RuntimeProofFailure("proof_invalid", path + "_HTTP_" + response.status, path);
    return { body, httpStatus: response.status };
  }
  throw new RuntimeProofFailure("worker_unreachable", "WORKER_UNREACHABLE", path, MAX_TRANSIENT_ATTEMPTS - 1);
}

export async function collectRuntimeProof({ fetchImpl = fetch, requestBaseUrl = baseUrl, maxReceiptAgeMsOverride = maxReceiptAgeMs, contextOverride = {}, now = Date.now() } = {}) {
  if (!requestBaseUrl || !/^https:\/\//i.test(requestBaseUrl)) throw new Error("HTTPS_NUSA_AUTOPILOT_URL_REQUIRED");
  if (!Number.isSafeInteger(maxReceiptAgeMsOverride) || maxReceiptAgeMsOverride < 60000 || maxReceiptAgeMsOverride > 3600000) {
    throw new Error("MAX_RECEIPT_AGE_INVALID");
  }

  const context = runtimeContext(contextOverride);
  const healthResponse = await readJson("/health", fetchImpl, requestBaseUrl);
  const health = healthResponse.body;
  assertSafety(health, "HEALTH");
  if (health.service !== "nusa-autopilot") throw new Error("HEALTH_SERVICE_INVALID");
  if (health.deploymentRevision === "UNVERIFIED" || typeof health.deploymentRevision !== "string" || !health.deploymentRevision.trim()) {
    throw new Error("DEPLOYMENT_REVISION_UNVERIFIED");
  }
  if (health.persistentExecutionCoordination !== "CONFIGURED") throw new Error("EXECUTION_COORDINATOR_NOT_CONFIGURED");

  const scheduledResponse = await readJson("/scheduled/status", fetchImpl, requestBaseUrl);
  const scheduled = scheduledResponse.body;
  assertSafety(scheduled, "SCHEDULED_STATUS");
  if (scheduled.status !== "OBSERVED" || !scheduled.receipt || typeof scheduled.receipt !== "object") {
    if (scheduled.status === "AWAITING_FIRST_SCHEDULED_EVENT" && scheduled.receipt == null) {
      throw new RuntimeProofFailure("proof_not_scheduled", "PROOF_NOT_SCHEDULED", "/scheduled/status");
    }
    throw new Error("SCHEDULED_RUNTIME_NOT_OBSERVED");
  }
  assertSafety(scheduled.receipt, "SCHEDULED_RECEIPT");
  const observedAt = scheduled.receipt.observedAt;
  if (!Number.isSafeInteger(observedAt) || observedAt < 0) throw new Error("SCHEDULED_RECEIPT_TIMESTAMP_INVALID");
  if (!SHA_40.test(scheduled.receipt.headSha ?? "")) throw new RuntimeProofFailure("proof_invalid", "SCHEDULED_RECEIPT_HEAD_INVALID", "/scheduled/status");
  const scheduledTime = scheduled.receipt.scheduledTime;
  if (Number.isSafeInteger(scheduledTime) && observedAt - scheduledTime > maxReceiptAgeMsOverride) {
    throw new RuntimeProofFailure("proof_scheduled_late", "PROOF_SCHEDULED_LATE", "/scheduled/status");
  }
  const ageMs = now - observedAt;
  if (ageMs < 0) throw new Error("SCHEDULED_RECEIPT_TIMESTAMP_IN_FUTURE");
  if (ageMs > maxReceiptAgeMsOverride) {
    throw new RuntimeProofFailure("worker_receipt_stale", "WORKER_RECEIPT_STALE", "/scheduled/status");
  }
  const eventDrivenProof = context.triggerType === "workflow_run" && context.sourceBranch === "main";
  const expectedMainSha = context.triggerType === "schedule" || context.sourceBranch === "main" ? context.sourceSha : null;
  const exactHeadVerified = expectedMainSha !== null && scheduled.receipt.headSha.toLowerCase() === expectedMainSha;
  if ((context.triggerType === "schedule" || eventDrivenProof) && !exactHeadVerified) {
    throw new RuntimeProofFailure("head_mismatch_failed_closed", "HEAD_MISMATCH_FAILED_CLOSED", "/scheduled/status");
  }
  const history = Array.isArray(scheduled.history) ? scheduled.history : [];
  const summary = scheduled.summary && typeof scheduled.summary === "object" ? scheduled.summary : null;
  // Scheduled proofs remain the hourly liveness signal. A successful canonical main-CI
  // workflow_run is an independent event-driven proof trigger; push/manual runs stay
  // insufficient so they cannot masquerade as either runtime cadence.
  const proofStatus = context.triggerType === "schedule" || eventDrivenProof ? "PROOF_FRESH" : "INSUFFICIENT_EVIDENCE";
  const workerReceiptIdentity = hashCanonical({
    scheduledTime,
    observedAt,
    status: scheduled.receipt.status,
    reason: scheduled.receipt.reason,
    headSha: scheduled.receipt.headSha.toLowerCase(),
    workflowRunId: scheduled.receipt.workflowRunId,
  });
  const proofIdentity = {
    workflow: context.workflowName,
    workflowRunId: context.workflowRunId,
    workflowRunAttempt: context.workflowRunAttempt,
    triggerType: context.triggerType,
    sourceSha: context.sourceSha,
    workerReceiptIdentity,
    proofStatus,
  };
  const evidenceFingerprint = hashCanonical(proofIdentity);

  const proof = {
    proof: "CLOUDFLARE_AUTOPILOT_RUNTIME_VERIFIED",
    proofId: evidenceFingerprint,
    proofStatus,
    workflow: context.workflowName,
    workflowRunId: context.workflowRunId,
    workflowRunAttempt: context.workflowRunAttempt,
    triggerType: context.triggerType,
    scheduledTimestamp: scheduledTime,
    actualStartTimestamp: context.actualStartTimestamp,
    observedTimestamp: observedAt,
    sourceBranch: context.sourceBranch,
    sourceSha: context.sourceSha,
    expectedMainSha,
    exactHeadVerified,
    deploymentRevision: health.deploymentRevision,
    receiptAgeMs: ageMs,
    latencyMs: context.actualStartTimestamp === null ? null : Math.max(0, now - context.actualStartTimestamp),
    httpStatusClasses: [Math.floor(healthResponse.httpStatus / 100) + "xx", Math.floor(scheduledResponse.httpStatus / 100) + "xx"],
    authenticationResult: "PUBLIC_READ_ONLY",
    scheduledStatus: scheduled.receipt.status,
    scheduledReason: scheduled.receipt.reason,
    workerReceiptIdentity,
    workerReceiptTimestamp: observedAt,
    workerReceiptWorkflowRunId: scheduled.receipt.workflowRunId,
    dedupeIdentity: workerReceiptIdentity,
    evidenceFingerprint,
    receiptCount: summary?.receiptCount ?? (history.length || 1),
    windowStart: summary?.windowStart ?? history[0]?.scheduledTime ?? observedAt,
    windowEnd: summary?.windowEnd ?? history.at(-1)?.scheduledTime ?? scheduled.receipt.scheduledTime,
    windowSpanMs: summary?.windowSpanMs ?? (history.length > 1 ? history.at(-1).scheduledTime - history[0].scheduledTime : 0),
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY"
  };
  return proof;
}

async function main() {
  const proof = await collectRuntimeProof();
  writeProofEvidence({ schemaVersion: 2, status: proof.proofStatus === "PROOF_FRESH" ? "PASS" : "INSUFFICIENT_EVIDENCE", classification: proof.proofStatus === "PROOF_FRESH" ? "proof_verified" : "proof_not_scheduled", checkedAt: Date.now(), ...proof });
  console.log(JSON.stringify(proof));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => fail(error));
}

