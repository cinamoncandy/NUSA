#!/usr/bin/env node

const baseUrl = (process.env.NUSA_AUTOPILOT_URL ?? process.argv[2] ?? "").trim().replace(/\/$/, "");
const maxReceiptAgeMs = Number(process.env.NUSA_AUTOPILOT_MAX_RECEIPT_AGE_MS ?? 180000);

function fail(message) {
  console.error(`CLOUDFLARE_RUNTIME_PROOF_FAILED:${message}`);
  process.exitCode = 1;
}

function assertSafety(body, label) {
  if (!body || typeof body !== "object") throw new Error(`${label}_BODY_INVALID`);
  if (body.liveAuthority !== "NONE") throw new Error(`${label}_LIVE_AUTHORITY_INVALID`);
  if (body.productionMutationAllowed !== false) throw new Error(`${label}_PRODUCTION_MUTATION_INVALID`);
  if (body.aiAuthority !== "ZERO_AUTHORITY") throw new Error(`${label}_AI_AUTHORITY_INVALID`);
}

async function readJson(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { accept: "application/json" } });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`${path}_NON_JSON_RESPONSE`); }
  if (!response.ok) throw new Error(`${path}_HTTP_${response.status}`);
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
    throw new Error("SCHEDULED_RUNTIME_NOT_OBSERVED");
  }
  assertSafety(scheduled.receipt, "SCHEDULED_RECEIPT");
  const observedAt = scheduled.receipt.observedAt;
  if (!Number.isSafeInteger(observedAt) || observedAt < 0) throw new Error("SCHEDULED_RECEIPT_TIMESTAMP_INVALID");
  const ageMs = Date.now() - observedAt;
  if (ageMs < 0 || ageMs > maxReceiptAgeMs) throw new Error(`SCHEDULED_RECEIPT_STALE:${ageMs}`);
  const history = Array.isArray(scheduled.history) ? scheduled.history : [];
  const summary = scheduled.summary && typeof scheduled.summary === "object" ? scheduled.summary : null;

  console.log(JSON.stringify({
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
    aiAuthority: "ZERO_AUTHORITY",
  }));
}

main().catch((error) => fail(error instanceof Error ? error.message : "UNKNOWN"));
