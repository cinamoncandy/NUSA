"use strict";
// Pure verdict for the Oracle PAPER release workflow (docs/NUSA_C4_RELEASE_THROUGH_CONTROLLER_DESIGN_2026-11-16.md 3.3).
// Read-only. A run counts as a deployment ONLY when every fact agrees; a missing fact is "not deployed", never success.
// 2026-11-16 19:38 KST: the run ended with conclusion success while every host step was skipped because protected main moved.
const SHA = /^[0-9a-f]{40}$/;
const CONTROLLER_OUTCOMES = new Set(["DEPLOYED", "ROLLED_BACK", "STOPPED_SAFE", "REFUSED", "STOPPED_UNCONFIRMED", "SUPERSEDED"]);

// input: { sourceSha, backupJob, releaseJob, deploymentResult, healthSha, healthOk, activation?, controllerOutcome?, controllerActiveSha?, controllerRuntimeOk? }
// activation "controller": the controller's outcome, its own reported active build and its runtime verification are ALL required.
function decide(input) {
  const i = input && typeof input === "object" ? input : {};
  const no = (result, reason) => ({ deployed: false, result, reason });
  if (!SHA.test(String(i.sourceSha ?? ""))) return no("NOT_DEPLOYED", "SOURCE_SHA_INVALID");
  if (i.backupJob !== "success") return no("NOT_DEPLOYED", `BACKUP_${String(i.backupJob || "MISSING").toUpperCase()}`);
  if (i.releaseJob !== "success" && i.releaseJob !== "failure" && i.releaseJob !== "cancelled") return no("NOT_DEPLOYED", `RELEASE_JOB_${String(i.releaseJob || "MISSING").toUpperCase()}`);
  // The workflow's own recheck of protected main: the host was never touched, so this is a clean "superseded", not a deployment.
  if (i.deploymentResult === "SKIPPED_MAIN_MOVED") return no("SUPERSEDED", "PROTECTED_MAIN_MOVED");
  // stage_only: the release directory was staged on purpose and nothing was activated. Not a deployment, and not a failure.
  if (i.deploymentResult === "STAGED_ONLY") return i.releaseJob === "success" ? no("STAGED_ONLY", "NOT_A_DEPLOYMENT") : no("FAILED", "STAGED_ONLY_WITHOUT_SUCCESSFUL_JOB");
  if (i.deploymentResult !== "DEPLOYED") return no("FAILED", String(i.deploymentResult || "RESULT_MISSING"));
  if (i.releaseJob !== "success") return no("FAILED", `RELEASE_JOB_${i.releaseJob.toUpperCase()}`);
  // Once the release goes through the controller its one-line outcome must say DEPLOYED as well; an unknown word is not a success,
  // and in controller mode a missing outcome is a failure (never an unreported success).
  const controllerMode = i.activation === "controller";
  const hasOutcome = i.controllerOutcome !== undefined && i.controllerOutcome !== "";
  if (controllerMode && !hasOutcome) return no("FAILED", "CONTROLLER_OUTCOME_MISSING");
  if (hasOutcome) {
    if (!CONTROLLER_OUTCOMES.has(i.controllerOutcome)) return no("FAILED", "CONTROLLER_OUTCOME_UNKNOWN");
    if (i.controllerOutcome !== "DEPLOYED") return no(i.controllerOutcome === "SUPERSEDED" ? "SUPERSEDED" : "FAILED", `CONTROLLER_${i.controllerOutcome}`);
  }
  // The controller's OWN view of the host (its read-only status): the recorded active build and the runtime verification it did itself.
  if (controllerMode || hasOutcome) {
    if (!SHA.test(String(i.controllerActiveSha ?? ""))) return no("FAILED", "CONTROLLER_ACTIVE_SHA_MISSING");
    if (i.controllerActiveSha !== i.sourceSha) return no("FAILED", "CONTROLLER_ACTIVE_SHA_MISMATCH");
    if (String(i.controllerRuntimeOk) !== "true") return no("FAILED", "CONTROLLER_RUNTIME_NOT_OK");
  }
  if (!SHA.test(String(i.healthSha ?? ""))) return no("FAILED", "HEALTH_SHA_MISSING");
  if (i.healthSha !== i.sourceSha) return no("FAILED", "HEALTH_SHA_MISMATCH");
  if (String(i.healthOk) !== "true") return no("FAILED", "HEALTH_NOT_OK");
  return { deployed: true, result: "DEPLOYED", reason: "ALL_FACTS_AGREE" };
}

function main(env) {
  const v = decide({ sourceSha: env.SOURCE_SHA, backupJob: env.BACKUP_JOB, releaseJob: env.RELEASE_JOB, deploymentResult: env.DEPLOYMENT_RESULT, healthSha: env.HEALTH_SHA, healthOk: env.HEALTH_OK, activation: env.ACTIVATION || "helper", controllerOutcome: env.CONTROLLER_OUTCOME, controllerActiveSha: env.CONTROLLER_ACTIVE_SHA, controllerRuntimeOk: env.CONTROLLER_RUNTIME_OK });
  const lines = [`deploymentResult=${v.result}`, `reason=${v.reason}`];
  if (!v.deployed) lines.push(`NOT DEPLOYED: ${v.result} (${v.reason})`);
  return { v, text: lines.join("\n") };
}

module.exports = { decide, main };
if (require.main === module) {
  const { v, text } = main(process.env);
  process.stdout.write(`${text}\n`);
  process.exit(v.deployed || v.result === "STAGED_ONLY" ? 0 : 1);
}
