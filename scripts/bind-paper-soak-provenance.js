const { readFileSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

function required(name, env) {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error(`${name} is required for GitHub-bound soak evidence`);
  return value;
}

function buildGitHubProvenance(env = process.env) {
  const repository = required("GITHUB_REPOSITORY", env);
  const sourceCommit = required("GITHUB_SHA", env).toLowerCase();
  const runId = required("GITHUB_RUN_ID", env);
  const runAttempt = required("GITHUB_RUN_ATTEMPT", env);
  const workflowRef = required("GITHUB_WORKFLOW_REF", env);
  const eventName = required("GITHUB_EVENT_NAME", env);
  const serverUrl = String(env.GITHUB_SERVER_URL || "https://github.com").replace(/\/$/, "");

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("GITHUB_REPOSITORY is invalid");
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error("GITHUB_SHA must be an exact 40-hex commit");
  if (!/^[1-9][0-9]*$/.test(runId)) throw new Error("GITHUB_RUN_ID is invalid");
  if (!/^[1-9][0-9]*$/.test(runAttempt)) throw new Error("GITHUB_RUN_ATTEMPT is invalid");
  if (serverUrl !== "https://github.com") throw new Error("untrusted GitHub server origin");

  return Object.freeze({
    verificationStatus: "BOUND_UNVERIFIED",
    repository,
    sourceCommit,
    runId,
    runAttempt,
    workflowRef,
    eventName,
    runUrl: `${serverUrl}/${repository}/actions/runs/${runId}`,
  });
}

function bindReceipt(receipt, env = process.env) {
  if (!receipt || receipt.evidenceType !== "PAPER_REAL_ELAPSED_SOAK") throw new Error("unexpected soak receipt");
  if (receipt.liveAuthority !== "NONE" || receipt.productionMutationAllowed !== false || receipt.aiAuthority !== "ZERO_AUTHORITY") {
    throw new Error("authority invariant violation in soak receipt");
  }
  return Object.freeze({ ...receipt, sourceProvenance: buildGitHubProvenance(env) });
}

function main() {
  const path = resolve(process.argv[2] || "artifacts/operational-evidence/paper-real-elapsed-soak.json");
  const receipt = JSON.parse(readFileSync(path, "utf8"));
  const bound = bindReceipt(receipt);
  writeFileSync(path, `${JSON.stringify(bound, null, 2)}\n`, "utf8");
}

if (require.main === module) main();
module.exports = { buildGitHubProvenance, bindReceipt };
