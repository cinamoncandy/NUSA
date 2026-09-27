"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { validateState, SAFETY } = require("./autopilot-runtime.js");

const statePath = path.resolve(process.env.NUSA_AUTOPILOT_STATE_PATH || "/var/lib/nusa/autopilot/runtime-state.json");
const timeoutMs = Number(process.env.NUSA_AUTOPILOT_READY_TIMEOUT_MS || 30_000);
const pollMs = Number(process.env.NUSA_AUTOPILOT_READY_POLL_MS || 500);
const intervalMs = Number(process.env.NUSA_AUTOPILOT_INTERVAL_MS || 60_000);
const maxAgeMs = Math.max(5_000, Math.min(300_000, intervalMs * 2));

function readState() {
  const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const validation = validateState(parsed);
  if (!validation.ok) throw new Error(`AUTOPILOT_STATE_INVALID:${validation.reason}`);
  if (parsed.stateRecovery === "CORRUPT") throw new Error("AUTOPILOT_STATE_CORRUPT");
  if (parsed.liveAuthority !== SAFETY.liveAuthority || parsed.productionMutationAllowed !== false || parsed.aiAuthority !== SAFETY.aiAuthority) {
    throw new Error("AUTOPILOT_SAFETY_INVARIANT_INVALID");
  }
  if (parsed.status === "BLOCKED" || parsed.status === "STOPPED") throw new Error(`AUTOPILOT_NOT_READY:${parsed.status}`);
  if (!Number.isSafeInteger(parsed.lastHeartbeatAt) || Date.now() - parsed.lastHeartbeatAt > maxAgeMs) throw new Error("AUTOPILOT_HEARTBEAT_STALE");
  return parsed;
}

async function main() {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) throw new Error("NUSA_AUTOPILOT_READY_TIMEOUT_MS_INVALID");
  if (!Number.isSafeInteger(pollMs) || pollMs < 100 || pollMs > 5_000) throw new Error("NUSA_AUTOPILOT_READY_POLL_MS_INVALID");
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() <= deadline) {
    try {
      const state = readState();
      console.log(JSON.stringify({ status: "PASS", statePath, runtimeStatus: state.status, stateRecovery: state.stateRecovery, iteration: state.iteration, lastHeartbeatAt: state.lastHeartbeatAt, liveAuthority: state.liveAuthority, productionMutationAllowed: state.productionMutationAllowed, aiAuthority: state.aiAuthority }));
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
  throw new Error(lastError?.message || "AUTOPILOT_READINESS_TIMEOUT");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { maxAgeMs, readState, statePath };
