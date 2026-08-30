#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const baseUrl = (process.env.NUSA_AUTOPILOT_URL ?? process.argv[2] ?? "").trim().replace(/\/$/, "");
const maxReceiptAgeMs = Number(process.env.NUSA_AUTOPILOT_MAX_RECEIPT_AGE_MS ?? 180000);
const proofOutputPath = (process.env.NUSA_RUNTIME_PROOF_OUTPUT ?? "").trim();

class RuntimeProofFailure extends Error {
  constructor(classification, reasonCode, endpoint) {
    super(reasonCode);
    this.name = "RuntimeProofFailure";
    this.classification = classification;
    this.reasonCode = reasonCode;
    this.endpoint = endpoint;
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
  const reasonCode = proofFailure ? error.reasonCode : "PROOF_VALIDATION_FAILED";
  const endpoint = proofFailure ? error.endpoint : null;
  writeProofEvidence({
    schemaVersion: 1,
    status: "FAIL",
    classification,
    reasonCode,
    endpoint,
    checkedAt: Date.now(),
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

async function readJson(path) {
  let response;
  try {
    response = await fetch(baseUrl + path, { headers: { accept: "application/json" } });
  } catch {
    throw new RuntimeProofFailure("worker_unreachable", "WORKER_UNREACHABLE", path);
  }
  let responseText;
  try {
    responseText = await response.text();
  } catch {
    throw new RuntimeProofFailure("worker_unreachable", "WORKER_RESPONSE_UNREADABLE", path);
  }
  let body;
  try {
    body = JSON.parse(responseText);
  } catch {
    throw new RuntimeProofFailure("proof_invalid", path + "_NON_JSON_RESPONSE", path);
  }
  if (!response.ok) throw new RuntimeProofFailure("worker_unreachable", path + "_HTTP_" + response.status, path);
  return body;
}

async function main() {
  if (!baseUrl || !/^https:\/\//i.test(baseUrl)) throw new Error("HTTPS_NUSA_AUTOPILOT_URL_REQUIRED");
  if (!Number.isSafeInteger(maxReceiptAgeMs) || maxReceiptAgeMs < 60000 || maxReceiptAgeMs > 3600000) {
    throw new Error("MAX_RECEIPT_AGE_INVALID");
  }

  const health = await readJson("/health");
  assertSafety(health, "HEALTH");
  if (health.service !== "nusa-autopilot") throw new Error("HEALTH_SERVICE_INVALID");
  if (health.deploymentRevision === "UNVERIFIED" || typeof health.deploymentRevision !== "string" || !health.deploymentRevision.trim()) {
    throw new Error("DEPLOYMENT_REVISION_UNVERIFIED");
  }
  if (health.persistentExecutionCoordination !== "CONFIGURED") throw new Error("EXECUTION_COORDINATOR_NOT_CONFIGURED");

  const scheduled = await readJson("/scheduled/status");
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
  const scheduledTime = scheduled.receipt.scheduledTime;
  if (Number.isSafeInteger(scheduledTime) && observedAt - scheduledTime > maxReceiptAgeMs) {
    throw new RuntimeProofFailure("proof_scheduled_late", "PROOF_SCHEDULED_LATE", "/scheduled/status");
  }
  const ageMs = Date.now() - observedAt;
  if (ageMs < 0) throw new Error("SCHEDULED_RECEIPT_TIMESTAMP_IN_FUTURE");
  if (ageMs > maxReceiptAgeMs) {
    throw new RuntimeProofFailure("worker_receipt_stale", "WORKER_RECEIPT_STALE", "/scheduled/status");
  }
  const history = Array.isArray(scheduled.history) ? scheduled.history : [];
  const summary = scheduled.summary && typeof scheduled.summary === "object" ? scheduled.summary : null;

  const proof = {
    proof: "CLOUDFLARE_AUTOPILOT_RUNTIME_VERIFIED",
    deploymentRevision: health.deploymentRevision,
    receiptAgeMs: ageMs,
    scheduledStatus: scheduled.receipt.status,
    scheduledReason: scheduled.receipt.reason,
    headSha: scheduled.receipt.headSha,
    workflowRunId: scheduled.receipt.workflowRunId,
    receiptCount: summary?.receiptCount ?? (history.length || 1),
    windowStart: summary?.windowStart ?? history[0]?.scheduledTime ?? observedAt,
    windowEnd: summary?.windowEnd ?? history.at(-1)?.scheduledTime ?? scheduled.receipt.scheduledTime,
    windowSpanMs: summary?.windowSpanMs ?? (history.length > 1 ? history.at(-1).scheduledTime - history[0].scheduledTime : 0),
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY"
  };
  writeProofEvidence({
    schemaVersion: 1,
    status: "PASS",
    classification: "proof_verified",
    checkedAt: Date.now(),
    ...proof
  });
  console.log(JSON.stringify(proof));
}

main().catch((error) => fail(error));
