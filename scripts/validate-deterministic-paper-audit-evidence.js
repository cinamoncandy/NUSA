const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");

const COMPLETE = "COMPLETE_AUTONOMOUS_EXECUTION_OBSERVED";
const INCOMPLETE = "INCOMPLETE_NO_AUTONOMOUS_ORDER_FILL_PNL";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function reject(message) {
  throw new Error(`EXACT_HEAD_PAPER_AUDIT_REJECTED:${message}`);
}

function requireCondition(condition, message) {
  if (!condition) reject(message);
}

function validateEvidence(evidence, metadata) {
  const head = String(metadata.requestedHead || "").toLowerCase();
  const runId = Number(metadata.runId);
  const artifactId = Number(metadata.artifactId);
  const artifactName = String(metadata.artifactName || "");
  const artifactDigest = String(metadata.artifactDigest || "");

  requireCondition(/^[a-f0-9]{40}$/.test(head), "HEAD_INVALID");
  requireCondition(evidence?.evidence_type === "nusa.actual-paper-runtime-e2e", "EVIDENCE_TYPE_MISMATCH");
  requireCondition(String(evidence?.source_commit || "").toLowerCase() === head, "SOURCE_COMMIT_MISMATCH");
  requireCondition(Number.isSafeInteger(runId) && runId > 0, "RUN_ID_INVALID");
  requireCondition(Number.isSafeInteger(artifactId) && artifactId > 0, "ARTIFACT_ID_INVALID");
  requireCondition(artifactName === `wo-0059-actual-paper-runtime-evidence-${head}`, "ARTIFACT_NAME_MISMATCH");
  requireCondition(/^sha256:[a-f0-9]{64}$/i.test(artifactDigest), "ARTIFACT_DIGEST_INVALID");

  const hash = evidence?.artifact_hash;
  requireCondition(hash?.algorithm === "sha256", "EVIDENCE_HASH_ALGORITHM");
  requireCondition(/^[a-f0-9]{64}$/i.test(String(hash?.value || "")), "EVIDENCE_HASH_MISSING");
  const { artifact_hash: _ignored, ...withoutHash } = evidence;
  requireCondition(sha256(canonical(withoutHash)) === String(hash.value).toLowerCase(), "EVIDENCE_HASH_MISMATCH");

  requireCondition(evidence?.authority?.mode === "PAPER_ONLY", "MODE_NOT_PAPER_ONLY");
  requireCondition(evidence?.authority?.liveAuthority === "NONE", "LIVE_AUTHORITY_NOT_NONE");
  requireCondition(evidence?.authority?.productionMutationAllowed === false, "PRODUCTION_MUTATION_ALLOWED");
  requireCondition(evidence?.authority?.aiAuthority === "ZERO_AUTHORITY", "AI_AUTHORITY_NOT_ZERO");
  requireCondition(evidence?.market_data?.provider === "UPBIT", "PUBLIC_MARKET_PROVIDER_MISMATCH");
  requireCondition(evidence?.market_data?.channel === "PUBLIC_TICKER", "PUBLIC_MARKET_CHANNEL_MISMATCH");
  requireCondition(evidence?.market_data?.private_credentials_used === false, "PRIVATE_CREDENTIALS_USED");
  requireCondition(evidence?.prohibited_capabilities?.upbit_private_credentials === false, "PRIVATE_EXCHANGE_CAPABILITY_PRESENT");
  requireCondition(evidence?.prohibited_capabilities?.live_order_endpoint === false, "LIVE_ORDER_ENDPOINT_PRESENT");
  requireCondition(evidence?.prohibited_capabilities?.withdrawal_transfer === false, "WITHDRAWAL_TRANSFER_PRESENT");
  requireCondition(evidence?.prohibited_capabilities?.real_money_mutation === false, "REAL_MONEY_MUTATION_OBSERVED");

  const smoke = evidence?.runtime_safety_smoke;
  requireCondition(smoke?.status === "PASS", "RUNTIME_SAFETY_SMOKE_NOT_PASS");
  requireCondition(smoke?.public_market_runtime_observed === true, "PUBLIC_MARKET_RUNTIME_NOT_OBSERVED");
  requireCondition(smoke?.live_authority === "NONE", "SMOKE_LIVE_AUTHORITY_NOT_NONE");
  requireCondition(smoke?.production_mutation_allowed === false, "SMOKE_PRODUCTION_MUTATION_ALLOWED");

  const certification = evidence?.autonomous_trading_certification;
  const readiness = evidence?.production_readiness;
  const certificationStatus = certification?.status;
  requireCondition(certificationStatus === COMPLETE || certificationStatus === INCOMPLETE, "AUTONOMOUS_CERTIFICATION_STATUS_INVALID");
  requireCondition(readiness?.status === certificationStatus, "READINESS_CERTIFICATION_STATUS_MISMATCH");
  requireCondition(readiness?.runtime_safety_smoke_passed === true, "PRODUCTION_SAFETY_SMOKE_NOT_PASS");
  requireCondition(readiness?.live_mutation_observed === false, "READINESS_LIVE_MUTATION_OBSERVED");

  const automaticOrderObserved = certification?.automatic_order_observed;
  const automaticFillObserved = certification?.automatic_fill_observed;
  const accountOrPnlChangeObserved = certification?.account_or_pnl_change_observed;
  requireCondition(typeof automaticOrderObserved === "boolean", "AUTOMATIC_ORDER_OBSERVATION_INVALID");
  requireCondition(typeof automaticFillObserved === "boolean", "AUTOMATIC_FILL_OBSERVATION_INVALID");
  requireCondition(typeof accountOrPnlChangeObserved === "boolean", "ACCOUNT_PNL_OBSERVATION_INVALID");
  requireCondition(readiness?.automatic_order_observed === automaticOrderObserved, "READINESS_ORDER_OBSERVATION_MISMATCH");
  requireCondition(readiness?.automatic_fill_observed === automaticFillObserved, "READINESS_FILL_OBSERVATION_MISMATCH");
  requireCondition(readiness?.account_or_pnl_change_observed === accountOrPnlChangeObserved, "READINESS_ACCOUNT_PNL_OBSERVATION_MISMATCH");

  const completeObserved = automaticOrderObserved && automaticFillObserved && accountOrPnlChangeObserved;
  const isComplete = certificationStatus === COMPLETE;
  if (isComplete) {
    requireCondition(completeObserved, "COMPLETE_WITHOUT_ORDER_FILL_PNL");
    requireCondition(evidence?.result === "PASS", "COMPLETE_RESULT_NOT_PASS");
    requireCondition(readiness?.completion_claim_allowed === true, "COMPLETE_CLAIM_NOT_ALLOWED");
  } else {
    requireCondition(!completeObserved, "INCOMPLETE_WITH_COMPLETE_EXECUTION_OBSERVATION");
    requireCondition(evidence?.result === "INCOMPLETE", "INCOMPLETE_RESULT_MISMATCH");
    requireCondition(readiness?.completion_claim_allowed === false, "INCOMPLETE_COMPLETION_CLAIM_ALLOWED");
  }

  return Object.freeze({
    status: "EXACT_HEAD_PAPER_SAFETY_PASS",
    head,
    source_run_id: runId,
    artifact_id: artifactId,
    artifact_name: artifactName,
    artifact_digest: artifactDigest,
    certification_status: certificationStatus,
    completion_claim_allowed: isComplete,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}

function validateEvidenceFile(evidencePath, metadata) {
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  return validateEvidence(evidence, metadata);
}

if (require.main === module) {
  const [evidencePath, requestedHead, runId, artifactId, artifactName, artifactDigest] = process.argv.slice(2);
  if (!evidencePath) {
    console.error("usage: node scripts/validate-deterministic-paper-audit-evidence.js <evidence.json> <head> <run-id> <artifact-id> <artifact-name> <artifact-digest>");
    process.exitCode = 1;
  } else {
    try {
      process.stdout.write(`${JSON.stringify(validateEvidenceFile(evidencePath, {
        requestedHead,
        runId,
        artifactId,
        artifactName,
        artifactDigest,
      }))}\n`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "EXACT_HEAD_PAPER_AUDIT_REJECTED:UNKNOWN");
      process.exitCode = 1;
    }
  }
}

module.exports = { COMPLETE, INCOMPLETE, canonical, sha256, validateEvidence, validateEvidenceFile };
