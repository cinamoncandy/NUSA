#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const evidencePath = (process.env.NUSA_RUNTIME_PROOF_OUTPUT ?? "artifacts/autopilot/runtime-proof.json").trim();
const sourceSha = String(process.env.NUSA_RUNTIME_PROOF_SOURCE_SHA ?? "").trim().toLowerCase();
const sourceBranch = String(process.env.NUSA_RUNTIME_PROOF_SOURCE_BRANCH ?? "").trim();
const repository = String(process.env.GITHUB_REPOSITORY ?? "").trim();
const maxAttempts = Number(process.env.NUSA_RUNTIME_SELF_HEAL_MAX_ATTEMPTS ?? 14);
const delayMs = Number(process.env.NUSA_RUNTIME_SELF_HEAL_DELAY_MS ?? 25000);

export function recoveryDecision(evidence) {
  const classification = String(evidence?.classification ?? "");
  const reason = String(evidence?.reasonCode ?? "");
  if (["worker_unreachable", "worker_receipt_stale", "proof_not_scheduled", "proof_scheduled_late", "head_mismatch_failed_closed"].includes(classification)) {
    return Object.freeze({ recoverable: true, reason: `${classification}:${reason || "UNKNOWN"}` });
  }
  if (classification === "proof_invalid" && reason === "SCHEDULED_RECEIPT_HEAD_INVALID") {
    return Object.freeze({ recoverable: true, reason: "scheduled-receipt-state-recovery" });
  }
  return Object.freeze({ recoverable: false, reason: `${classification || "unknown"}:${reason || "UNKNOWN"}` });
}

function runVerifier() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/verify-autopilot-cloudflare-runtime.mjs"], { stdio: "inherit", env: process.env });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

function currentMainSha() {
  return new Promise((resolve) => {
    if (sourceBranch !== "main" || !repository || !/^[0-9a-f]{40}$/.test(sourceSha)) return resolve(sourceSha);
    const child = spawn("gh", ["api", `repos/${repository}/branches/main`, "--jq", ".commit.sha"], { stdio: ["ignore", "pipe", "inherit"], env: process.env });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.on("exit", (code) => resolve(code === 0 ? output.trim().toLowerCase() : null));
    child.on("error", () => resolve(null));
  });
}

function readProofEvidence() {
  try {
    return existsSync(evidencePath) ? JSON.parse(readFileSync(evidencePath, "utf8")) : null;
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runSelfHeal({
  verify = runVerifier,
  wait = sleep,
  readEvidence = readProofEvidence,
  readCurrentMain = currentMainSha,
} = {}) {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) throw new Error("SELF_HEAL_ATTEMPT_BUDGET_INVALID");
  if (!Number.isSafeInteger(delayMs) || delayMs < 1000 || delayMs > 60000) throw new Error("SELF_HEAL_DELAY_INVALID");

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    rmSync(evidencePath, { force: true });
    const code = await verify();
    const evidence = readEvidence();

    if (code === 0) {
      if (evidence?.status === "PASS" && evidence?.proofStatus === "PROOF_FRESH") {
        return Object.freeze({ status: "VERIFIED", attempts: attempt });
      }
      return Object.freeze({ status: "INSUFFICIENT_EVIDENCE", attempts: attempt, reason: evidence?.proofStatus ?? "PROOF_STATUS_MISSING" });
    }

    const decision = recoveryDecision(evidence);
    console.log(`AUTOPILOT_RUNTIME_SELF_HEAL attempt=${attempt} recoverable=${decision.recoverable} reason=${decision.reason}`);

    if (!decision.recoverable) {
      return Object.freeze({ status: "FAILED_CLOSED", attempts: attempt, reason: decision.reason });
    }

    if (String(evidence?.classification ?? "") === "head_mismatch_failed_closed" && sourceBranch === "main") {
      const currentMain = await readCurrentMain();
      if (currentMain && currentMain !== sourceSha) {
        console.log(`AUTOPILOT_RUNTIME_SELF_HEAL_STALE_SOURCE source=${sourceSha} currentMain=${currentMain}`);
        return Object.freeze({ status: "STALE_SOURCE_SUPPRESSED", attempts: attempt, reason: "MAIN_ADVANCED" });
      }
    }

    if (attempt === maxAttempts) {
      return Object.freeze({ status: "FAILED_CLOSED", attempts: attempt, reason: decision.reason });
    }

    await wait(delayMs);
  }

  return Object.freeze({ status: "FAILED_CLOSED", attempts: maxAttempts, reason: "ATTEMPT_BUDGET_EXHAUSTED" });
}

async function main() {
  const result = await runSelfHeal();
  if (result.status === "VERIFIED" || result.status === "STALE_SOURCE_SUPPRESSED") {
    console.log(`AUTOPILOT_RUNTIME_SELF_HEAL_${result.status} attempts=${result.attempts}`);
    return;
  }
  if (result.status === "INSUFFICIENT_EVIDENCE") {
    console.log(`AUTOPILOT_RUNTIME_SELF_HEAL_INSUFFICIENT:${result.reason}`);
    return;
  }
  console.error(`AUTOPILOT_RUNTIME_SELF_HEAL_FAILED:${result.reason}`);
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "AUTOPILOT_RUNTIME_SELF_HEAL_FAILED");
    process.exitCode = 1;
  });
}
