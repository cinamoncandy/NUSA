const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { execFileSync } = require("node:child_process");
const { block, scalar } = require("./validate-aipos-drift.js");

const COMPILED_CLOUD_RUNTIME = "dist/apps/cloud/src/closedLearningProductionRuntime.js";

const REQUIRED_RUNTIME_FILES = Object.freeze([
  "apps/cloud/src/runtime.ts",
  "apps/cloud/src/closedLearningProductionRuntime.ts",
  "apps/cloud/src/server.ts",
  "apps/cloud/src/cloudRuntimeConfig.ts"
]);

const WO_AI_009_PATH = ".aipos/work-orders/WO-AI-009-governed-outcome-attribution-learning.yaml";

const STALE_README_CLAIMS = Object.freeze([
  "Not currently deployed or wired into a running process",
  "a real token issuer, a persistence backend, and a hosting decision"
]);

const STALE_NEXT_TASK_CLAIMS = Object.freeze([
  "strategy research promotion gate (parallel second layer)",
  "Two WO-0031 layers now exist on this branch and neither has been removed.",
  "Consolidating onto one is an open owner decision."
]);

function read(root, relativePath, failures) {
  const path = join(root, relativePath);
  if (!existsSync(path)) {
    failures.push(`REPOSITORY_TRUTH_PATH_MISSING:${relativePath}`);
    return "";
  }
  return readFileSync(path, "utf8");
}

function normalizeWhitespace(source) {
  return source.replace(/\s+/g, " ").trim();
}

function defaultIsAncestor(root, commit) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", commit, "HEAD"], {
      cwd: root,
      stdio: "ignore"
    });
    return true;
  } catch {
    return false;
  }
}

function listIds(source) {
  return [...source.matchAll(/^\s*- id:\s*["']?([^\s"']+)["']?\s*$/gm)].map((match) => match[1]);
}

function validateRepositoryTruth(root = process.cwd(), options = {}) {
  const failures = [];
  const readme = read(root, "README.md", failures);
  const nextTask = read(root, "docs/NEXT_TASK.md", failures);
  const normalizedNextTask = normalizeWhitespace(nextTask);
  const packageSource = read(root, "package.json", failures);
  const state = read(root, ".aipos/state.yaml", failures);
  const currentMission = read(root, ".aipos/current-mission.yaml", failures);
  const woAi009 = read(root, WO_AI_009_PATH, failures);

  let packageJson;
  try {
    packageJson = JSON.parse(packageSource);
  } catch {
    failures.push("REPOSITORY_TRUTH_PACKAGE_JSON_INVALID");
    packageJson = {};
  }

  for (const relativePath of REQUIRED_RUNTIME_FILES) {
    if (!existsSync(join(root, relativePath))) failures.push(`CLOUD_RUNTIME_PATH_MISSING:${relativePath}`);
  }

  // The documented entry point must still start the compiled Cloud production composition root.
  // It may do so through the launcher that supplies operational defaults, in which case the
  // launcher itself has to reference that exact compiled entrypoint. This follows the indirection
  // rather than accepting any script that merely mentions the launcher.
  const cloudRuntimeScript = packageJson?.scripts?.["cloud:runtime"];
  const launcherRelativePath = "scripts/start-cloud-runtime.js";
  const launcherSource = existsSync(join(root, launcherRelativePath))
    ? readFileSync(join(root, launcherRelativePath), "utf8")
    : "";
  const startsCompiledRuntime = typeof cloudRuntimeScript === "string"
    && (cloudRuntimeScript.includes(COMPILED_CLOUD_RUNTIME)
      || (cloudRuntimeScript.includes(launcherRelativePath) && launcherSource.includes(COMPILED_CLOUD_RUNTIME)));
  if (!startsCompiledRuntime) {
    failures.push("CLOUD_RUNTIME_SCRIPT_MISSING_OR_DRIFTED");
  }
  if (packageJson?.scripts?.["architecture:truth"] !== "node scripts/validate-repository-truth.js") {
    failures.push("ARCHITECTURE_TRUTH_SCRIPT_NOT_REGISTERED");
  }

  if (!readme.includes("## Cloud PAPER runtime")) failures.push("README_CLOUD_RUNTIME_SECTION_MISSING");
  if (!readme.includes("pnpm cloud:runtime")) failures.push("README_CLOUD_RUNTIME_COMMAND_MISSING");
  if (!readme.includes("liveAuthority") || !readme.includes("productionMutationAllowed")) {
    failures.push("README_AUTHORITY_BOUNDARY_MISSING");
  }
  for (const staleClaim of STALE_README_CLAIMS) {
    if (readme.includes(staleClaim)) failures.push(`README_STALE_RUNTIME_CLAIM:${staleClaim}`);
  }

  if (!normalizedNextTask.includes("WO-0031 has one canonical research-promotion authority.")) {
    failures.push("NEXT_TASK_WO0031_CANONICAL_AUTHORITY_MISSING");
  }
  if (
    !normalizedNextTask.includes("scorecard.js") ||
    !normalizedNextTask.includes("must not emit, own, or imply an independent research-promotion decision")
  ) {
    failures.push("NEXT_TASK_WO0031_SCORECARD_BOUNDARY_MISSING");
  }
  for (const staleClaim of STALE_NEXT_TASK_CLAIMS) {
    if (normalizedNextTask.includes(normalizeWhitespace(staleClaim))) {
      failures.push(`NEXT_TASK_STALE_WO0031_CLAIM:${staleClaim}`);
    }
  }

  const ai009PlanningGate = block(woAi009, "planning_gate");
  const ai009ImplementationGate = block(woAi009, "implementation_gate");
  const ai009Verification = block(woAi009, "verification");
  const ai009PlanningStatus = scalar(ai009PlanningGate, "status");
  const ai009PlanningHead = scalar(ai009PlanningGate, "exact_head");
  const ai009PlanningMerge = scalar(ai009PlanningGate, "merge_commit");
  if (ai009PlanningStatus !== "MERGED") failures.push(`WO_AI_009_PLANNING_GATE_NOT_MERGED:${ai009PlanningStatus || "missing"}`);
  if (!/^[0-9a-f]{40}$/.test(ai009PlanningHead || "")) failures.push("WO_AI_009_PLANNING_HEAD_INVALID");
  if (!/^[0-9a-f]{40}$/.test(ai009PlanningMerge || "")) failures.push("WO_AI_009_PLANNING_MERGE_INVALID");
  if (scalar(ai009Verification, "result") !== "PASS") failures.push("WO_AI_009_PLANNING_VERIFICATION_NOT_PASS");
  if (scalar(ai009ImplementationGate, "status") === "BLOCKED_UNTIL_PLANNING_MERGED") {
    failures.push("WO_AI_009_IMPLEMENTATION_GATE_STALE_BLOCK");
  }

  const inProgress = block(state, "in_progress");
  const inProgressIds = listIds(inProgress);
  const currentMissionId = scalar(currentMission, "id");
  if (!currentMissionId) {
    failures.push("AIPOS_CURRENT_MISSION_ID_MISSING");
  } else if (inProgressIds.length > 0 && !inProgressIds.includes(currentMissionId)) {
    failures.push(`AIPOS_CURRENT_MISSION_DRIFT:${currentMissionId}`);
  }

  const verifiedState = block(state, "verified_state");
  const verifiedStatus = scalar(verifiedState, "status");
  const verifiedEvidence = scalar(verifiedState, "evidence");
  if (verifiedStatus === "COMPLETED") {
    if (!verifiedEvidence || !existsSync(join(root, verifiedEvidence))) failures.push("AIPOS_VERIFIED_EVIDENCE_MISSING");
    const verification = block(state, "verification");
    const currentCommit = scalar(verification, "current_commit") || "";
    if (/pending exact-head verification/i.test(currentCommit)) failures.push("AIPOS_VERIFIED_STATE_CONTRADICTS_PENDING_WORDING");
  }

  const baseCommit = scalar(state, "base_commit");
  if (!/^[0-9a-f]{40}$/.test(baseCommit || "")) {
    failures.push("AIPOS_BASE_COMMIT_INVALID");
  } else {
    const isAncestor = options.isAncestor || defaultIsAncestor;
    if (!isAncestor(root, baseCommit)) failures.push(`AIPOS_BASE_COMMIT_NOT_ANCESTOR:${baseCommit}`);
  }

  const restrictedLive = block(state, "restricted_live_authority");
  if (scalar(restrictedLive, "real_money_execution") !== "prohibited") failures.push("AIPOS_REAL_MONEY_BOUNDARY_DRIFT");
  if (scalar(restrictedLive, "credential_execution_use") !== "prohibited") failures.push("AIPOS_CREDENTIAL_EXECUTION_BOUNDARY_DRIFT");

  return { ok: failures.length === 0, failures };
}

if (require.main === module) {
  const result = validateRepositoryTruth();
  if (!result.ok) {
    console.error("Repository architecture truth validation FAILED");
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("Repository architecture truth validation PASS");
}

module.exports = {
  REQUIRED_RUNTIME_FILES,
  WO_AI_009_PATH,
  STALE_README_CLAIMS,
  STALE_NEXT_TASK_CLAIMS,
  validateRepositoryTruth
};
